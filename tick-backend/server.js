const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const app = express();

// Enable CORS for your Vercel frontend domain
app.use(cors({
    origin: '*', // Production mein yahan apna specific Vercel URL daal dena security ke liye
    credentials: true
}));
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// Anti-self-open memory caches
const senderIpCache = new Map();
const proxyFleetCache = new Map();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const LEMON_SQUEEZY_WEBHOOK_SECRET = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || '';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("FATAL: Missing SUPABASE_URL or SUPABASE_ANON_KEY variables.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Authentication Middleware for Frontend (Vercel JWT verification)
const requireUserAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Missing token' });
        }
        const token = authHeader.split(' ')[1];
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Invalid token' });
        }
        req.user_id = user.id;
        next();
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Internal server authentication error' });
    }
};

// API Key Middleware for Programmatic Scripts (cold_blast.py execution)
const requireApiKeyAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Missing API Key' });
        }
        const token = authHeader.split(' ')[1];
        const { data: keyData, error } = await supabase
            .from('api_keys')
            .select('user_id')
            .eq('token', token)
            .single();

        if (error || !keyData) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
        }

        req.user_id = keyData.user_id;
        // Background update for last used timestamp without blocking request
        supabase.from('api_keys').update({ last_used: new Date().toISOString() }).eq('token', token).then();
        next();
    } catch (err) {
        return res.status(500).json({ success: false, error: 'Internal server token verification error' });
    }
};

const returnBeacon = (res) => {
    try {
        const beaconBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        const imgBuffer = Buffer.from(beaconBase64, 'base64');
        res.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': imgBuffer.length,
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store',
            'Vary': '*',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(imgBuffer);
    } catch (error) {
        res.status(500).end();
    }
};

app.get('/', (req, res) => {
    res.status(200).send('TICKK Telemetry Engine Node: Operational');
});

// 1. REGISTER ENDPOINT — Programmatic Script Entry (cold_blast.py integration)
app.post('/api/trackers/register', requireApiKeyAuth, async (req, res) => {
    const { recipient, subject, link_url } = req.body;

    if (!recipient || !subject) {
        return res.status(400).json({ success: false, error: 'Recipient and Subject are mandatory parameters' });
    }

    try {
        const { data, error } = await supabase
            .from('trackers')
            .insert([{
                user_id: req.user_id,
                recipient,
                subject,
                link_url: link_url || null
            }])
            .select()
            .single();

        if (error) return res.status(500).json({ success: false, error: error.message });

        // Cache sender identity to block self-opens
        let senderIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
        if (senderIp && senderIp.includes(',')) senderIp = senderIp.split(',')[0].trim();
        if (senderIp) {
            senderIpCache.set(data.id, senderIp);
            setTimeout(() => senderIpCache.delete(data.id), 24 * 60 * 60 * 1000);
        }

        res.status(201).json({ success: true, tracker_id: data.id });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. FETCH ENDPOINT — Return Isolated Data to Frontend
app.get('/api/trackers', requireUserAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('trackers')
            .select('*')
            .eq('user_id', req.user_id)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ success: false, error: error.message });
        res.json({ success: true, trackers: data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. PIXEL GATEWAY — CDN Cache Breaker Redirect
app.get('/api/track/:tracker_id/pixel.png', (req, res) => {
    const trackerId = req.params.tracker_id;
    const redirectTarget = `/api/telemetry/open?id=${encodeURIComponent(trackerId)}&_t=${Date.now()}`;
    res.writeHead(302, {
        'Location': redirectTarget,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0, s-maxage=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Surrogate-Control': 'no-store'
    });
    res.end();
});

// 4. REAL TRACKING PROCESSING ENGINE (State Machine with Apple MPP detection)
app.get('/api/telemetry/open', async (req, res) => {
    const trackerId = req.query.id || '';
    if (!trackerId || trackerId === 'undefined') return returnBeacon(res);

    try {
        const { data: tracker, error: fError } = await supabase.from('trackers').select('*').eq('id', trackerId).maybeSingle();
        if (fError || !tracker) return returnBeacon(res);

        let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
        const userAgent = req.headers['user-agent'] || '';

        // Rule 1 Isolation
        if (ip && senderIpCache.get(trackerId) === ip) return returnBeacon(res);

        const isGoogleNetwork = ip && (ip.startsWith('209.85.') || ip.startsWith('142.250.') || ip.startsWith('74.125.'));
        const isProxyBot = userAgent.includes('GoogleImageProxy') || userAgent.includes('YahooCacheSystem') || isGoogleNetwork;
        const isAppleMpp = userAgent.includes('CloudImageService') || userAgent.includes('AppleMail');

        // Rule 3 Proxy handling
        if (isProxyBot && tracker.status === 'UNOPENED') {
            proxyFleetCache.set(trackerId, Date.now());
            setTimeout(() => proxyFleetCache.delete(trackerId), 10000);
            await supabase.from('trackers').update({ status: 'DELIVERED', updated_at: new Date().toISOString() }).eq('id', trackerId);
            return res.status(204).end(); // Forces refresh on human click
        }

        const deliveryWindow = proxyFleetCache.get(trackerId);
        if (isProxyBot && deliveryWindow && (Date.now() - deliveryWindow < 4000)) {
            return returnBeacon(res); // Drop edge fleet requests
        }

        // Parse and resolve geolocation details asynchronously
        let city = 'Unknown';
        let country = 'N/A';
        if (ip && !isGoogleNetwork) {
            try {
                const geoRes = await fetch(`http://ip-api.com/json/${ip}`);
                if (geoRes.ok) {
                    const geoData = await geoRes.json();
                    if (geoData.status === 'success') {
                        city = geoData.city;
                        country = geoData.country;
                    }
                }
            } catch (gErr) { }
        }

        // Update Tracker Metrics
        await supabase.from('trackers').update({
            status: 'OPENED',
            open_count: tracker.open_count + 1,
            updated_at: new Date().toISOString()
        }).eq('id', trackerId);

        // Insert Dimensional Telemetry Log row
        await supabase.from('telemetry_logs').insert([{
            tracker_id: trackerId,
            type: 'open',
            ip_address: ip,
            user_agent: userAgent,
            city,
            country,
            is_mpp_proxy: !!isAppleMpp
        }]);

        return returnBeacon(res);
    } catch (err) {
        return returnBeacon(res);
    }
});

// 5. CNAME LINK INTERCEPTION REDIRECTION
app.get('/api/track/:tracker_id/click', async (req, res) => {
    const trackerId = req.params.tracker_id;
    const destinationUrl = decodeURIComponent(req.query.url || '');
    if (!trackerId || !destinationUrl) return res.status(400).send('Bad Request Parameters');

    try {
        const { data: tracker } = await supabase.from('trackers').select('*').eq('id', trackerId).maybeSingle();
        if (tracker) {
            await supabase.from('trackers').update({
                status: 'OPENED',
                click_count: tracker.click_count + 1,
                open_count: tracker.open_count === 0 ? 1 : tracker.open_count,
                updated_at: new Date().toISOString()
            }).eq('id', trackerId);

            let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
            if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
            const userAgent = req.headers['user-agent'] || '';

            await supabase.from('telemetry_logs').insert([{
                tracker_id: trackerId,
                type: 'click',
                ip_address: ip,
                user_agent: userAgent
            }]);
        }
    } catch (err) { }

    return res.redirect(destinationUrl);
});

// 6. LEMON SQUEEZY BILLING WEBHOOK
app.post('/api/webhooks/billing', async (req, res) => {
    try {
        const secret = LEMON_SQUEEZY_WEBHOOK_SECRET;
        if (!secret) {
            console.error('Webhook secret not configured.');
            return res.status(500).send('Webhook secret not configured.');
        }

        const hmac = crypto.createHmac('sha256', secret);
        const digest = Buffer.from(hmac.update(req.rawBody).digest('hex'), 'utf8');
        const signature = Buffer.from(req.get('X-Signature') || '', 'utf8');

        if (digest.length !== signature.length || !crypto.timingSafeEqual(digest, signature)) {
            return res.status(403).json({ success: false, error: 'Invalid signature' });
        }

        const payload = req.body;
        const eventName = payload.meta.event_name;

        // Extract user UUID from custom_data
        const userId = payload.meta.custom_data && payload.meta.custom_data.user_id;

        if (!userId) {
            return res.status(400).json({ success: false, error: 'Missing user_id in custom_data' });
        }

        if (eventName === 'subscription_created') {
            await supabase.from('profiles').update({
                plan_tier: 'Growth Core Access',
                resource_credits: 10000
            }).eq('id', userId);
        } else if (eventName === 'subscription_payment_failed' || eventName === 'subscription_expired' || eventName === 'subscription_cancelled') {
            await supabase.from('profiles').update({
                plan_tier: 'Telemetry Starter'
            }).eq('id', userId);
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TICKK Core System Running on port ${PORT}`));