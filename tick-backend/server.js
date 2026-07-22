const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const dns = require('dns');
const { Resend } = require('resend');

console.log("[INIT] API Key loaded:", process.env.RESEND_API_KEY ? "Yes" : "No");
const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Process-Level Crash Handlers (must be registered before anything else) ───
process.on('uncaughtException', (err) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'UNCAUGHT_EXCEPTION',
        error: err.message,
        stack: err.stack
    }));
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'UNHANDLED_REJECTION',
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
    }));
});

const app = express();

// Enable CORS for your Vercel frontend domain
app.use(cors({
    origin: true, // Echo origin to allow credentials and Authorization header
    credentials: true
}));
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf;
    }
}));

// 1. Global Request Logger
app.use((req, res, next) => {
    console.log(`[TICKK-LOG] ${new Date().toISOString()} | Method: ${req.method} | URL: ${req.url}`);
    next();
});

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

app.get('/:verification_file.html', (req, res, next) => {
    const token = process.env.GOOGLE_SITE_VERIFICATION_TOKEN;
    if (token && req.params.verification_file === token) {
        res.setHeader('Content-Type', 'text/html');
        return res.status(200).send(`google-site-verification: ${req.params.verification_file}.html`);
    }
    next();
});

// ==========================================
// OAUTH2 FLOWS (Google & Outlook)
// ==========================================
const FRONTEND_DASHBOARD_URL = process.env.FRONTEND_DASHBOARD_URL || 'http://localhost:5173/dashboard';

// --- GOOGLE OAUTH ---
app.get('/api/auth/google', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).send("userId is required");
    
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = 'https://tickk-backend.onrender.com/api/auth/google/callback';
    const scope = encodeURIComponent('https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email');
    
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${state}`;
    
    res.redirect(authUrl);
});

app.get('/api/auth/google/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${FRONTEND_DASHBOARD_URL}?error=${error}`);
    if (!code || !state) return res.redirect(`${FRONTEND_DASHBOARD_URL}?error=invalid_request`);
    
    try {
        const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        const userId = decodedState.userId;
        const redirectUri = 'https://tickk-backend.onrender.com/api/auth/google/callback';
        
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri
            })
        });
        const tokens = await tokenResponse.json();
        
        if (!tokens.access_token) throw new Error("Failed to retrieve access token");
        
        await supabase.from('profiles').update({
            google_access_token: tokens.access_token,
            google_refresh_token: tokens.refresh_token || null,
            auth_provider: 'google'
        }).eq('id', userId);
        
        res.redirect(`${FRONTEND_DASHBOARD_URL}?token=google_connected`);
    } catch (err) {
        console.error("Google OAuth Error:", err);
        res.redirect(`${FRONTEND_DASHBOARD_URL}?error=oauth_failed`);
    }
});

// --- OUTLOOK OAUTH ---
app.get('/api/auth/outlook', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.status(400).send("userId is required");
    
    const clientId = process.env.OUTLOOK_CLIENT_ID;
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/outlook/callback`;
    const scope = encodeURIComponent('offline_access Mail.Send User.Read');
    
    const state = Buffer.from(JSON.stringify({ userId })).toString('base64');
    
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&response_mode=query&scope=${scope}&state=${state}`;
    
    res.redirect(authUrl);
});

app.get('/api/auth/outlook/callback', async (req, res) => {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${FRONTEND_DASHBOARD_URL}?error=${error}`);
    if (!code || !state) return res.redirect(`${FRONTEND_DASHBOARD_URL}?error=invalid_request`);
    
    try {
        const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        const userId = decodedState.userId;
        const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/outlook/callback`;
        
        const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: process.env.OUTLOOK_CLIENT_ID,
                client_secret: process.env.OUTLOOK_CLIENT_SECRET,
                code,
                grant_type: 'authorization_code',
                redirect_uri: redirectUri
            })
        });
        const tokens = await tokenResponse.json();
        
        if (!tokens.access_token) throw new Error("Failed to retrieve access token");
        
        await supabase.from('profiles').update({
            outlook_access_token: tokens.access_token,
            outlook_refresh_token: tokens.refresh_token || null,
            auth_provider: 'outlook'
        }).eq('id', userId);
        
        res.redirect(`${FRONTEND_DASHBOARD_URL}?token=outlook_connected`);
    } catch (err) {
        console.error("Outlook OAuth Error:", err);
        res.redirect(`${FRONTEND_DASHBOARD_URL}?error=oauth_failed`);
    }
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

// 1b. OUTBOUND EMAIL CAMPAIGN VALIDATION ENDPOINT (Atomic Credit Verification & Dispatch)
app.post('/api/track/dispatch', requireUserAuth, async (req, res) => {
    const { recipient, subject, link_url } = req.body;

    if (!recipient || !subject) {
        return res.status(400).json({ success: false, error: 'Recipient and Subject are mandatory parameters' });
    }

    try {
        // Step 1: Atomic Credit Verification Engine
        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', req.user_id)
            .single();

        if (profileErr || !profile) {
            return res.status(500).json({ success: false, error: 'Failed to retrieve user profile for credit verification' });
        }

        const credits = profile.credits || 0;
        let isLocked = false;

        // Step 2: Conditional Credit Multiplier & Deduction
        if (credits > 0) {
            const { error: deductErr } = await supabase
                .from('profiles')
                .update({ credits: credits - 1 })
                .eq('id', req.user_id);

            if (deductErr) {
                return res.status(500).json({ success: false, error: 'Transaction failed: Could not deduct credit' });
            }
        } else {
            // Step 3: Zero-Credit Soft Lock Protocol
            isLocked = true;
        }

        // Insert into trackers pipeline (allow dispatch data pipeline logs for dashboard streams)
        const { data, error } = await supabase
            .from('trackers')
            .insert([{
                user_id: req.user_id,
                recipient,
                subject,
                link_url: link_url || null,
                is_locked: isLocked // Flag status context
            }])
            .select()
            .single();

        if (error) return res.status(500).json({ success: false, error: error.message });

        // Cache sender identity
        let senderIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
        if (senderIp && senderIp.includes(',')) senderIp = senderIp.split(',')[0].trim();
        if (senderIp) {
            senderIpCache.set(data.id, senderIp);
            setTimeout(() => senderIpCache.delete(data.id), 24 * 60 * 60 * 1000);
        }

        // Security Rule Enforcement: Return response without tracking params if locked
        if (isLocked) {
            return res.status(201).json({ 
                success: true, 
                message: 'Dispatch allowed but tracking structurally disabled (Zero Credits).',
                tracker_id: data.id,
                tracking: null
            });
        }

        // Normal dispatch pipeline: generate tracking parameters link/pixel injection
        const origin = req.headers.origin || 'https://tickk.io';
        const pixelUrl = `${origin}/api/track/${data.id}/pixel.png`;
        const trackedLink = data.link_url ? `${origin}/api/track/${data.id}/click?url=${encodeURIComponent(data.link_url)}` : null;

        res.status(201).json({ 
            success: true, 
            tracker_id: data.id,
            tracking: {
                pixelUrl,
                trackedLink
            }
        });
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

// 2b. FETCH API KEYS — Return Isolated Data to Frontend
app.get('/api/keys', requireUserAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('api_keys')
            .select('*')
            .eq('user_id', req.user_id)
            .order('created_at', { ascending: false });

        if (error) return res.status(500).json({ success: false, error: error.message });
        res.json({ success: true, api_keys: data });
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

        // Security Rule: If tracker is structurally locked (Zero-Credit), do not generate/fire tracking initialization
        if (tracker.is_locked) {
            return returnBeacon(res);
        }

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
            } catch (gErr) { console.error('Geo lookup failed:', gErr.message); }
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
            // Security Rule: If tracker is structurally locked, skip tracking logic and just redirect
            if (tracker.is_locked) {
                return res.redirect(destinationUrl);
            }

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
    } catch (err) { console.error('Click tracking error:', err.message); }

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
                plan: 'growth',
                credits: 10000
            }).eq('id', userId);
        } else if (eventName === 'subscription_payment_failed' || eventName === 'subscription_expired' || eventName === 'subscription_cancelled') {
            await supabase.from('profiles').update({
                plan: 'free'
            }).eq('id', userId);
        }

        res.status(200).json({ success: true });
    } catch (err) {
        console.error('Webhook processing error:', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// 7. DASHBOARD STATS — Frontend integration endpoint
app.get('/api/stats/:userId', requireUserAuth, async (req, res) => {
    const { userId } = req.params;
    
    // Strict isolation check
    if (req.user_id !== userId) {
        return res.status(403).json({ error: 'Forbidden: You can only access your own stats' });
    }

    try {
        const { data, error } = await supabase
            .from('trackers')
            .select(`
                *,
                telemetry_logs (*)
            `)
            .eq('user_id', userId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        // Agar data empty bhi ho, tab bhi 200 return karo, crash mat ho
        res.status(200).json(data || []);
    } catch (err) {
        console.error(`[CRITICAL ERROR] Supabase fetch failed:`, err);
        res.status(500).json({ error: err.message });
    }
});

// 8. TRACKER LOGS — Fetch telemetry timeline for a specific tracker
app.get('/api/logs/:trackerId', async (req, res) => {
    const { trackerId } = req.params;
    try {
        const { data, error } = await supabase
            .from('telemetry_logs')
            .select('*')
            .eq('tracker_id', trackerId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.status(200).json(data || []);
    } catch (err) {
        console.error(`[CRITICAL ERROR] Supabase telemetry logs fetch failed:`, err);
        res.status(500).json({ error: err.message });
    }
});

// 8b. PERFORMANCE HEATMAP — Exact timestamps array strictly filtered for user
app.get('/api/analytics/performance', requireUserAuth, async (req, res) => {
    try {
        // Step 1: Securely get only THIS user's trackers
        const { data: trackers, error: trackerErr } = await supabase
            .from('trackers')
            .select('id')
            .eq('user_id', req.user_id);

        if (trackerErr) throw trackerErr;

        if (!trackers || trackers.length === 0) {
            return res.status(200).json({ success: true, timestamps: [] });
        }

        const trackerIds = trackers.map(t => t.id);

        // Step 2: Fetch created_at for ONLY those trackers
        const { data: logs, error: logsErr } = await supabase
            .from('telemetry_logs')
            .select('created_at')
            .in('tracker_id', trackerIds)
            .order('created_at', { ascending: true });

        if (logsErr) throw logsErr;

        // Extract raw array of timestamps
        const timestamps = logs.map(log => log.created_at);
        
        res.status(200).json({ success: true, timestamps });
    } catch (err) {
        console.error(`[CRITICAL ERROR] Performance heatmap fetch failed:`, err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8c. ACTIVITY DISTRIBUTION — When you sent your messages
app.get('/api/performance/activity-distribution', requireUserAuth, async (req, res) => {
    try {
        // Fetch all trackers (sent messages) for the logged-in user
        const { data: trackers, error: trackerErr } = await supabase
            .from('trackers')
            .select('created_at')
            .eq('user_id', req.user_id);

        if (trackerErr) throw trackerErr;

        if (!trackers || trackers.length === 0) {
            return res.status(200).json({ success: true, distribution: [] });
        }

        const distributionMap = new Map();

        trackers.forEach(tracker => {
            const date = new Date(tracker.created_at);
            const day = date.getDay(); // 0 (Sunday) to 6 (Saturday)
            const hour = date.getHours(); // 0 to 23

            const key = `${day}-${hour}`;
            if (distributionMap.has(key)) {
                distributionMap.set(key, distributionMap.get(key) + 1);
            } else {
                distributionMap.set(key, 1);
            }
        });

        const distribution = [];
        distributionMap.forEach((count, key) => {
            const [day, hour] = key.split('-').map(Number);
            distribution.push({ day, hour, count });
        });

        res.status(200).json({ success: true, distribution });
    } catch (err) {
        console.error(`[CRITICAL ERROR] Activity distribution fetch failed:`, err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 11. ADMIN APPROVE FEEDBACK ENDPOINT
app.post('/api/admin/approve-feedback', async (req, res) => {
    const { feedbackId } = req.body;
    if (!feedbackId) return res.status(400).json({ success: false, error: 'feedbackId is required' });

    try {
        // Update feedback status
        const { data: feedback, error: fError } = await supabase
            .from('feedback')
            .update({ status: 'approved' })
            .eq('id', feedbackId)
            .select()
            .single();

        if (fError || !feedback) {
            console.error('[APPROVE FEEDBACK ERROR]', fError);
            return res.status(500).json({ success: false, error: fError?.message || 'Feedback not found', details: fError });
        }

        // Increment user credits by 99
        const { data: profile, error: pError } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', feedback.user_id)
            .single();

        if (pError || !profile) {
            return res.status(500).json({ success: false, error: pError?.message || 'Profile not found' });
        }

        const newCredits = profile.credits + 99;
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ credits: newCredits })
            .eq('id', feedback.user_id);

        if (updateError) {
            return res.status(500).json({ success: false, error: updateError.message });
        }

        res.json({ success: true, message: 'Feedback approved and 99 credits added.' });
    } catch (err) {
        console.error('[APPROVE FEEDBACK ERROR]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// 12. CLAIM REWARD ENDPOINT
app.post('/api/profile/claim-feedback-popup', requireUserAuth, async (req, res) => {
    try {
        const { error } = await supabase
            .from('feedback')
            .update({ reward_claimed: true })
            .eq('user_id', req.user_id)
            .eq('status', 'approved')
            .eq('reward_claimed', false);

        if (error) {
            console.error('[CLAIM FEEDBACK ERROR]', error);
            return res.status(500).json({ success: false, error: error.message, details: error });
        }

        res.json({ success: true, message: 'Reward claimed successfully.' });
    } catch (err) {
        console.error('[CLAIM REWARD ERROR]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// 13. FETCH LOGGED-IN USER DETAILS
app.get('/api/auth/me', requireUserAuth, async (req, res) => {
    try {
        const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', req.user_id)
            .single();

        if (error || !profile) {
            return res.status(404).json({ success: false, error: 'User profile not found' });
        }

        res.json({ success: true, user: profile });
    } catch (err) {
        console.error('[AUTH ME ERROR]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// 9. SEND OTP DIRECTLY VIA RESEND
app.post('/api/auth/send-otp', async (req, res) => {
    console.log(`[TICKK-LOG] Hit /api/auth/send-otp for email: ${req.body.email}`);
    const { email, password, name } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }

    try {
        // --- Duplicate Email Handling ---
        // Note: supabase.auth.admin.getUserByEmail() doesn't exist in the JS SDK,
        // so we look up the user's ID via the profiles table first.
        const { data: profile } = await supabase.from('profiles').select('id').ilike('email', email).maybeSingle();
        
        if (profile) {
            const { data: adminData } = await supabase.auth.admin.getUserById(profile.id);
            const user = adminData?.user;
            
            // Check if user is confirmed
            if (user && (user.email_confirmed_at || user.confirmed_at)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'USER_EXISTS', 
                    message: 'User already exists and is confirmed.' 
                });
            }
        }
        // --------------------------------

        let linkData, linkError;

        // If password is provided, it's a signup request
        if (password) {
            const result = await supabase.auth.admin.generateLink({
                type: 'signup',
                email: email,
                password: password,
                data: { name: name }
            });
            linkData = result.data;
            linkError = result.error;
        } else {
            // Otherwise, just a magic link login
            const result = await supabase.auth.admin.generateLink({
                type: 'magiclink',
                email: email,
            });
            linkData = result.data;
            linkError = result.error;
        }

        if (linkError) {
            console.error('[AUTH ERROR] generateLink failed:', linkError);
            return res.status(500).json({ success: false, error: linkError.message });
        }

        // Extract the magic link
        const authLink = linkData.properties.action_link;

        // Send email via Resend
        const { data, error } = await resend.emails.send({
            from: 'Tickk Auth <noreply@qorvx.online>', // Change to your verified domain (e.g., noreply@yourdomain.com)
            to: [email],
            subject: 'Your Tickk Login Link',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2>Welcome to Tickk</h2>
                    <p>Click the secure link below to sign in to your account:</p>
                    <a href="${authLink}" style="display:inline-block; padding:12px 24px; background-color:#000; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold; margin:20px 0;">Sign In to Tickk</a>
                    <p style="color:#666; font-size:14px;">If you didn't request this link, you can safely ignore this email.</p>
                </div>
            `
        });

        if (error) {
            console.error('[RESEND ERROR] Failed to send email:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.status(200).json({ success: true, message: 'Login link sent successfully' });
    } catch (err) {
        console.error('[OTP ENDPOINT ERROR]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// 10. PASSWORD RESET VIA RESEND (Link Sent flow — mirrors send-otp)
app.post('/api/auth/reset-password', async (req, res) => {
    console.log(`[TICKK-LOG] Hit /api/auth/reset-password for email: ${req.body.email}`);
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }

    try {
        // Generate a recovery link using Supabase Auth Admin
        const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email: email,
        });

        if (linkError) {
            console.error('[AUTH ERROR] generateLink (recovery) failed:', linkError);
            return res.status(500).json({ success: false, error: linkError.message });
        }

        // Extract the recovery link
        const resetLink = linkData.properties.action_link;

        // Send email via Resend
        const { data, error } = await resend.emails.send({
            from: 'Tickk Auth <noreply@qorvx.online>',
            to: [email],
            subject: 'Reset Your Tickk Password',
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <h2>Reset your password</h2>
                    <p>We received a request to reset the password for your Tickk account. Click the secure link below to set a new password:</p>
                    <a href="${resetLink}" style="display:inline-block; padding:12px 24px; background-color:#000; color:#fff; text-decoration:none; border-radius:6px; font-weight:bold; margin:20px 0;">Reset Password</a>
                    <p style="color:#666; font-size:14px;">This link will expire shortly. If you didn't request a password reset, you can safely ignore this email.</p>
                </div>
            `
        });

        if (error) {
            console.error('[RESEND ERROR] Failed to send reset email:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        res.status(200).json({ success: true, message: 'Password reset link sent successfully' });
    } catch (err) {
        console.error('[RESET PASSWORD ENDPOINT ERROR]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.get("/api/feedback", requireUserAuth, async (req, res) => {
  const userId = req.user_id;

  const { data: tickets, error } = await supabase
    .from('feedback')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[FETCH TICKETS ERROR]', error);
  }

  res.json(tickets || []);
});

app.post("/api/feedback", requireUserAuth, async (req, res) => {
  const userId = req.user_id;

  const { subject, category, message } = req.body;
  

  const spamKeywords = ["spam", "test", "fake"];
  const lowerMessage = message.toLowerCase();
  if (spamKeywords.some(kw => lowerMessage.includes(kw))) {
    return res.status(400).json({ error: "Invalid or spam content detected" });
  }

  const { data: ticket, error } = await supabase
    .from('feedback')
    .insert([{
      user_id: userId,
      subject,
      category,
      message,
      status: 'submitted'
    }])
    .select()
    .single();

  if (error || !ticket) {
    console.error('[FEEDBACK INSERT ERROR]', error);
    return res.status(500).json({ error: "Failed to submit feedback", details: error?.message || 'Unknown error' });
  }

  res.status(201).json({ ticket });
});

app.patch("/api/feedback/:id/notify", requireUserAuth, async (req, res) => {
  const feedbackId = req.params.id;
  const userId = req.user_id;

  const { data, error } = await supabase
    .from('feedback')
    .update({ is_notified: true })
    .eq('id', feedbackId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error || !data) {
    console.error('[NOTIFY FEEDBACK ERROR]', error);
    return res.status(500).json({ error: "Failed to update notification status", details: error?.message || 'Unknown error' });
  }

  res.json({ success: true, feedback: data });
});

// ==========================================
// CUSTOM DOMAIN ROUTES
// ==========================================

app.post('/api/domains/add', requireUserAuth, async (req, res) => {
    const { domain_name } = req.body;
    if (!domain_name) {
        return res.status(400).json({ success: false, error: 'Domain name is required' });
    }

    try {
        const verificationToken = 'tickk-verify-' + crypto.randomBytes(16).toString('hex');
        
        const { data, error } = await supabase
            .from('custom_domains')
            .insert([{
                user_id: req.user_id,
                domain_name,
                verification_token: verificationToken
            }])
            .select()
            .single();

        if (error) {
            console.error('[DOMAIN ADD ERROR]', error);
            if (error.code === '23505') { // Unique violation
                return res.status(400).json({ success: false, error: 'Domain already exists' });
            }
            return res.status(500).json({ success: false, error: 'Failed to add domain' });
        }

        res.status(201).json({
            success: true,
            domain: data,
            instructions: {
                cname: {
                    name: 'track',
                    target: 'tickk-backend.onrender.com'
                },
                txt: {
                    name: '_tickk-challenge',
                    target: verificationToken
                }
            }
        });
    } catch (err) {
        console.error('[DOMAIN ADD EXCEPTION]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.post('/api/domains/verify', requireUserAuth, async (req, res) => {
    const { domain_name } = req.body;
    if (!domain_name) {
        return res.status(400).json({ success: false, error: 'Domain name is required' });
    }

    try {
        const { data: domainRec, error: dbErr } = await supabase
            .from('custom_domains')
            .select('*')
            .eq('domain_name', domain_name)
            .eq('user_id', req.user_id)
            .single();

        if (dbErr || !domainRec) {
            return res.status(404).json({ success: false, error: 'Domain not found' });
        }

        if (domainRec.is_verified) {
            return res.json({ success: true, verified: true, message: 'Domain is already verified' });
        }

        let isCnameValid = false;
        let isTxtValid = false;

        // Verify CNAME
        try {
            const cnameRecords = await dns.promises.resolveCname(`track.${domain_name}`);
            if (cnameRecords.includes('tickk-backend.onrender.com')) {
                isCnameValid = true;
            }
        } catch (dnsErr) {
            console.error(`[DNS CNAME ERROR] ${domain_name}:`, dnsErr.message);
        }

        // Verify TXT
        try {
            const txtRecords = await dns.promises.resolveTxt(`_tickk-challenge.${domain_name}`);
            const flattenedTxt = txtRecords.map(t => t.join('')).flat();
            if (flattenedTxt.includes(domainRec.verification_token)) {
                isTxtValid = true;
            }
        } catch (dnsErr) {
            console.error(`[DNS TXT ERROR] ${domain_name}:`, dnsErr.message);
        }

        if (isCnameValid && isTxtValid) {
            const { error: updateErr } = await supabase
                .from('custom_domains')
                .update({ is_verified: true })
                .eq('id', domainRec.id);

            if (updateErr) {
                return res.status(500).json({ success: false, error: 'Failed to update verification status' });
            }

            return res.json({ success: true, verified: true, message: 'Domain verified successfully' });
        } else {
            return res.json({ 
                success: true, 
                verified: false, 
                error: 'DNS records not propagated yet or incorrect',
                details: { cname: isCnameValid, txt: isTxtValid }
            });
        }
    } catch (err) {
        console.error('[DOMAIN VERIFY EXCEPTION]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// ==========================================
// CHROME EXTENSION API
// ==========================================
app.post('/api/extension/auth-token-exchange', async (req, res) => {
    try {
        const { accessToken } = req.body;
        if (!accessToken) {
            return res.status(400).json({ success: false, error: 'Missing accessToken' });
        }

        const { data: { user }, error: authErr } = await supabase.auth.getUser(accessToken);
        if (authErr || !user) {
            return res.status(401).json({ success: false, error: 'Invalid access token' });
        }

        const userId = user.id;

        let { data: apiKeyData, error: keyErr } = await supabase
            .from('api_keys')
            .select('token')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        let apiKey = apiKeyData?.token;

        if (!apiKey) {
            apiKey = 'tk_live_' + crypto.randomBytes(24).toString('hex');
            const { error: insertErr } = await supabase
                .from('api_keys')
                .insert([{ user_id: userId, token: apiKey, name: 'Extension Auto-Sync Key' }]);
                
            if (insertErr) {
                return res.status(500).json({ success: false, error: 'Failed to generate API Key' });
            }
        }

        return res.json({ success: true, apiKey, userId });
    } catch (err) {
        console.error('[AUTH TOKEN EXCHANGE ERROR]', err);
        return res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.get('/api/extension/user-info', async (req, res) => {
    try {
        let userId = null;
        const apiKey = req.headers['x-api-key'];
        const authHeader = req.headers.authorization;

        if (apiKey) {
            const { data: keyData, error: keyErr } = await supabase
                .from('api_keys')
                .select('user_id')
                .eq('token', apiKey)
                .single();

            if (keyErr || !keyData) {
                return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
            }
            userId = keyData.user_id;

            // Background update for last used timestamp
            supabase.from('api_keys').update({ last_used: new Date().toISOString() }).eq('token', apiKey).then();
        } else if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const { data: { user }, error } = await supabase.auth.getUser(token);
            if (error || !user) {
                return res.status(401).json({ success: false, error: 'Unauthorized: Invalid Bearer token' });
            }
            userId = user.id;
        } else {
            return res.status(401).json({ success: false, error: 'Unauthorized: Missing authentication' });
        }

        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            return res.status(500).json({ success: false, error: 'Failed to retrieve user profile' });
        }

        const { data: recentEmails, error: trackersErr } = await supabase
            .from('trackers')
            .select('recipient, subject, status, open_count, updated_at')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(5);

        if (trackersErr) {
            return res.status(500).json({ success: false, error: 'Failed to retrieve recent emails' });
        }

        res.json({
            success: true,
            credits: profile.credits || 0,
            recent_emails: recentEmails || []
        });
    } catch (err) {
        console.error('[EXTENSION API ERROR]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

app.post('/api/track/create', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'];
        if (!apiKey) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Missing x-api-key header' });
        }

        const { data: keyData, error: keyErr } = await supabase
            .from('api_keys')
            .select('user_id')
            .eq('token', apiKey)
            .single();

        if (keyErr || !keyData) {
            return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
        }

        const userId = keyData.user_id;
        const { recipient, subject } = req.body;

        if (!recipient || !subject) {
            return res.status(400).json({ success: false, error: 'Recipient and Subject are required' });
        }

        const { data: profile, error: profileErr } = await supabase
            .from('profiles')
            .select('credits')
            .eq('id', userId)
            .single();

        if (profileErr || !profile) {
            return res.status(500).json({ success: false, error: 'Failed to retrieve user profile' });
        }

        if (profile.credits <= 0) {
            return res.status(403).json({ success: false, error: 'Insufficient credits' });
        }

        const { error: deductErr } = await supabase
            .from('profiles')
            .update({ credits: profile.credits - 1 })
            .eq('id', userId);

        if (deductErr) {
            return res.status(500).json({ success: false, error: 'Transaction failed: Could not deduct credit' });
        }

        const { data: tracker, error: trackerErr } = await supabase
            .from('trackers')
            .insert([{
                user_id: userId,
                recipient,
                subject,
                status: 'sent',
                open_count: 0
            }])
            .select()
            .single();

        if (trackerErr || !tracker) {
            return res.status(500).json({ success: false, error: 'Failed to create tracker' });
        }

        supabase.from('api_keys').update({ last_used: new Date().toISOString() }).eq('token', apiKey).then();

        res.json({ success: true, trackerId: tracker.id });
    } catch (err) {
        console.error('[TRACK CREATE ERROR]', err);
        res.status(500).json({ success: false, error: 'Internal Server Error' });
    }
});

// 2. Global Error Handler
app.use((err, req, res, next) => {
    console.error(`[TICKK-ERROR] ${new Date().toISOString()} | Stack: ${err.stack}`);
    res.status(500).send('Internal Server Error');
});

// ─── Server Startup ───
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        type: 'SERVER_START',
        port: PORT,
        node_version: process.version,
        env: process.env.NODE_ENV || 'development'
    }));
});