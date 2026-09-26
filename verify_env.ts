
const envVars = [
  'PAYSTACK_SECRET_KEY',
  'VTPASS_API_KEY',
  'VTPASS_SECRET_KEY',
  'VTPASS_PUBLIC_KEY',
  'CLUBKONNECT_USER_ID',
  'CLUBKONNECT_API_KEY',
  'RESEND_API_KEY',
  'SYSTEM_EMAIL_SENDER',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'VITE_PAYSTACK_PUBLIC_KEY',
  'NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY',
  'PAYSTACK_WEBHOOK_SECRET'
];

console.log("--- Environment Variable Presence Audit ---");
envVars.forEach(v => {
  const value = process.env[v];
  const status = value ? 'CONFIGURED' : 'MISSING';
  console.log(`${v}: ${status}`);
});
