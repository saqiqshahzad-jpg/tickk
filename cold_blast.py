import requests
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

# ==========================================
# ⚙️ CONFIGURATION
# ==========================================
# Local testing ke liye localhost, real-world ke liye hum ise ngrok se replace karenge
BACKEND_URL = "https://d775b154f19b6ee2-39-34-146-156.serveousercontent.com"  
API_KEY = "tk_live_test123"

# SMTP Settings (Gmail/Outlook standard setup)
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SENDER_EMAIL = "tickkmail@gmail.com"       # Apni sending email dalo
SENDER_PASSWORD = "wytjlpesyzwjsnoi"       # Google App Password dalo

RECIPIENT_EMAIL = "saqiqshahzad@gmail.com" # Jis email par test bhejni hai
SUBJECT = "TICKK Outbound Telemetry Live Node Test"

# ==========================================
# 🚀 STEP 1: REGISTER THE OUTBOUND TRACKER
# ==========================================
print("[TICKK Script] Registering campaign tracker in backend...")
register_endpoint = f"{BACKEND_URL}/api/trackers/register"
headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}
payload = {
    "recipient": RECIPIENT_EMAIL,
    "subject": SUBJECT
}

try:
    response = requests.post(register_endpoint, json=payload, headers=headers)
    if response.status_code == 201:
        data = response.json()
        tracker_id = data["tracker_id"]
        print(f"[TICKK Script] Success! Tracker registered with ID: {tracker_id}")
    else:
        print(f"[TICKK Script] Registration Failed: {response.status_code} - {response.text}")
        exit(1)
except Exception as e:
    print(f"[TICKK Script] Connection Error: {e}")
    exit(1)

# ==========================================
# 📧 STEP 2: INJECT HIDDEN STEALTH PIXEL
# ==========================================
pixel_url = f"{BACKEND_URL}/api/track/{tracker_id}/pixel.png"

msg = MIMEMultipart('alternative')
msg['Subject'] = SUBJECT
msg['From'] = SENDER_EMAIL
msg['To'] = RECIPIENT_EMAIL

# Core HTML content with our live pixel injected at the bottom
html_content = f"""
<html>
  <body style="font-family: sans-serif; padding: 20px; color: #333;">
    <h2>Asalam-o-Alaikum, Saqib Bhai!</h2>
    <p>This email was dispatched via programmatic cold_blast.py script.</p>
    <p>Once opened, it will trigger the TICKK tracking state machine on our backend server.</p>
    <br/>
    <p>Best regards,<br/><strong>TICKK Developer Cluster</strong></p>

    <!-- Invisible Telemetry Pixel -->
    <img src="{pixel_url}" width="1" height="1" style="display:none !important;" />
  </body>
</html>
"""

msg.attach(MIMEText(html_content, 'html'))

# ==========================================
# 📤 STEP 3: DISPATCH VIA SMTP RELAY
# ==========================================
print("[TICKK Script] Dispatching outbound transmission...")
try:
    server = smtplib.SMTP(SMTP_SERVER, SMTP_PORT)
    server.starttls()
    server.login(SENDER_EMAIL, SENDER_PASSWORD)
    server.sendmail(SENDER_EMAIL, RECIPIENT_EMAIL, msg.as_string())
    server.quit()
    print(f"[TICKK Script] ✅ Email successfully dispatched to {RECIPIENT_EMAIL}!")
except Exception as e:
    print(f"[TICKK Script] SMTP Fail: {e}")