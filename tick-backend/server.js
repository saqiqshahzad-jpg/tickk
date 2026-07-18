const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
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
    origin: '*', // Production mein yahan apna specific Vercel URL daal dena security ke liye
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
app.get('/api/stats/:userId', async (req, res) => {
    const { userId } = req.params;
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
            return res.status(500).json({ success: false, error: fError?.message || 'Feedback not found' });
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
            return res.status(500).json({ success: false, error: error.message });
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