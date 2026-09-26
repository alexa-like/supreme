/**
 * Supreme Digital Network — Production Email Templates
 * Stage 2.14 Production Notifications, Email Delivery & Communication Infrastructure
 * 
 * BRANDING INVARIANTS:
 * 1. Supreme Digital Network / Supreme / SDN branding.
 * 2. Mobile-friendly responsive layout with clean typography.
 * 3. NO secrets, passwords, PINs, or full BVN/NIN.
 * 4. Authoritative transaction data & STS tokens.
 */

export interface EmailRenderInput {
  eventType: string;
  recipientName?: string;
  email: string;
  amountFormatted?: string; // e.g. "₦5,000.00"
  reference?: string;
  dateIso?: string;
  details?: Record<string, any>;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function baseHtmlTemplate(contentHtml: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; color: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden; }
    .header { background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%); padding: 24px; text-align: center; }
    .header h1 { margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .header p { margin: 4px 0 0; color: #e0f2fe; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; }
    .content { padding: 32px 24px; }
    .badge { display: inline-block; padding: 6px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; text-transform: uppercase; margin-bottom: 16px; }
    .badge-success { background-color: #064e3b; color: #34d399; border: 1px solid #059669; }
    .badge-info { background-color: #075985; color: #38bdf8; border: 1px solid #0284c7; }
    .badge-warning { background-color: #78350f; color: #fbbf24; border: 1px solid #d97706; }
    .badge-danger { background-color: #7f1d1d; color: #f87171; border: 1px solid #dc2626; }
    .amount { font-size: 32px; font-weight: 800; color: #38bdf8; margin: 12px 0 24px; text-align: center; }
    .table-info { width: 100%; border-collapse: collapse; margin: 20px 0; font-size: 14px; }
    .table-info td { padding: 10px 12px; border-bottom: 1px solid #334155; }
    .table-info tr:last-child td { border-bottom: none; }
    .table-info td.label { color: #94a3b8; width: 40%; font-weight: 500; }
    .table-info td.value { color: #f8fafc; font-weight: 600; text-align: right; }
    .token-box { background-color: #0f172a; border: 2px dashed #0284c7; border-radius: 8px; padding: 16px; text-align: center; margin: 24px 0; }
    .token-title { color: #94a3b8; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
    .token-code { color: #38bdf8; font-size: 24px; font-weight: 800; font-family: monospace; letter-spacing: 2px; }
    .footer { background-color: #0f172a; padding: 20px 24px; text-align: center; border-top: 1px solid #334155; font-size: 12px; color: #64748b; }
    .footer p { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>SUPREME DIGITAL NETWORK</h1>
      <p>Official Transaction Notification</p>
    </div>
    <div class="content">
      ${contentHtml}
    </div>
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} Supreme Digital Network. All rights reserved.</p>
      <p>For support, contact support@supremedigitalnetwork.com</p>
      <p>This is an automated operational email. Please do not reply directly.</p>
    </div>
  </div>
</body>
</html>`;
}

export function renderEmailTemplate(input: EmailRenderInput): RenderedEmail {
  const name = input.recipientName || 'Valued Customer';
  const ref = input.reference || 'N/A';
  const dateStr = input.dateIso ? new Date(input.dateIso).toUTCString() : new Date().toUTCString();
  const amt = input.amountFormatted || '₦0.00';
  const details = input.details || {};

  switch (input.eventType) {
    case 'WELCOME': {
      const subject = 'Welcome to Supreme Digital Network';
      const html = baseHtmlTemplate(
        `<h2>Welcome, ${name}!</h2>
         <p>Thank you for creating an account with Supreme Digital Network. You now have instant access to seamless airtime, data bundles, utility bills, and digital payments.</p>
         <div class="badge badge-info">ACCOUNT READY</div>
         <p>Ensure your account security by enabling two-factor authentication and setting up strong credentials.</p>`,
        subject
      );
      const text = `Welcome to Supreme Digital Network, ${name}! Your account is ready for seamless digital payments.`;
      return { subject, html, text };
    }

    case 'WALLET_FUNDING_SUCCESS': {
      const subject = `Wallet Credited: ${amt} — Supreme Digital Network`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-success">Payment Successful</span></div>
         <div class="amount">${amt}</div>
         <p>Hello ${name}, your Supreme wallet has been successfully credited.</p>
         <table class="table-info">
           <tr><td class="label">Amount Credited</td><td class="value">${amt}</td></tr>
           <tr><td class="label">Transaction Reference</td><td class="value">${ref}</td></tr>
           <tr><td class="label">Payment Gateway</td><td class="value">${details.gateway || 'Paystack'}</td></tr>
           <tr><td class="label">Date & Time</td><td class="value">${dateStr}</td></tr>
         </table>`,
        subject
      );
      const text = `Hello ${name}, your wallet has been credited with ${amt}. Ref: ${ref}. Date: ${dateStr}.`;
      return { subject, html, text };
    }

    case 'VAS_AIRTIME_SUCCESS': {
      const subject = `Airtime Delivered: ${amt} to ${details.recipient || 'Phone'} — Supreme`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-success">Vending Successful</span></div>
         <div class="amount">${amt}</div>
         <p>Hello ${name}, your Airtime recharge has been delivered successfully.</p>
         <table class="table-info">
           <tr><td class="label">Network Provider</td><td class="value">${details.network || 'Telecom'}</td></tr>
           <tr><td class="label">Recipient Phone</td><td class="value">${details.recipient || 'N/A'}</td></tr>
           <tr><td class="label">Amount</td><td class="value">${amt}</td></tr>
           <tr><td class="label">Order Reference</td><td class="value">${ref}</td></tr>
           <tr><td class="label">Date</td><td class="value">${dateStr}</td></tr>
         </table>`,
        subject
      );
      const text = `Airtime recharge of ${amt} to ${details.recipient} on ${details.network} was successful. Ref: ${ref}.`;
      return { subject, html, text };
    }

    case 'VAS_DATA_SUCCESS': {
      const subject = `Data Bundle Delivered: ${details.planName || 'Data'} — Supreme`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-success">Vending Successful</span></div>
         <div class="amount">${amt}</div>
         <p>Hello ${name}, your Data bundle subscription was delivered successfully.</p>
         <table class="table-info">
           <tr><td class="label">Network</td><td class="value">${details.network || 'Telecom'}</td></tr>
           <tr><td class="label">Data Plan</td><td class="value">${details.planName || 'Data Bundle'}</td></tr>
           <tr><td class="label">Recipient Phone</td><td class="value">${details.recipient || 'N/A'}</td></tr>
           <tr><td class="label">Amount Charged</td><td class="value">${amt}</td></tr>
           <tr><td class="label">Order Reference</td><td class="value">${ref}</td></tr>
         </table>`,
        subject
      );
      const text = `Data bundle ${details.planName} to ${details.recipient} was successful. Ref: ${ref}.`;
      return { subject, html, text };
    }

    case 'VAS_ELECTRICITY_SUCCESS': {
      const subject = `Electricity Token Issued: ${amt} (${details.disco || 'Utility'}) — Supreme`;
      const stsToken = details.stsToken || 'N/A';
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-success">Token Issued</span></div>
         <div class="amount">${amt}</div>
         <div class="token-box">
           <div class="token-title">Your Meter Recharge STS Token</div>
           <div class="token-code">${stsToken}</div>
         </div>
         <p>Hello ${name}, your electricity token has been generated by the utility provider.</p>
         <table class="table-info">
           <tr><td class="label">Distribution Co. (DISCO)</td><td class="value">${details.disco || 'N/A'}</td></tr>
           <tr><td class="label">Meter Number</td><td class="value">${details.meterNumber || 'N/A'}</td></tr>
           <tr><td class="label">Customer Name</td><td class="value">${details.customerName || name}</td></tr>
           <tr><td class="label">Units Delivered</td><td class="value">${details.units || 'N/A'}</td></tr>
           <tr><td class="label">Order Reference</td><td class="value">${ref}</td></tr>
         </table>`,
        subject
      );
      const text = `Electricity token for ${details.disco} meter ${details.meterNumber}: TOKEN: ${stsToken}. Amount: ${amt}. Ref: ${ref}.`;
      return { subject, html, text };
    }

    case 'VAS_CABLE_SUCCESS': {
      const subject = `Cable TV Subscribed: ${details.bouquet || 'Subscription'} — Supreme`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-success">Subscription Active</span></div>
         <div class="amount">${amt}</div>
         <p>Hello ${name}, your Cable TV subscription has been activated.</p>
         <table class="table-info">
           <tr><td class="label">Operator</td><td class="value">${details.operator || 'Cable TV'}</td></tr>
           <tr><td class="label">Smartcard / IUC</td><td class="value">${details.smartcard || 'N/A'}</td></tr>
           <tr><td class="label">Bouquet</td><td class="value">${details.bouquet || 'Package'}</td></tr>
           <tr><td class="label">Order Reference</td><td class="value">${ref}</td></tr>
         </table>`,
        subject
      );
      const text = `Cable TV subscription ${details.bouquet} for ${details.operator} smartcard ${details.smartcard} was activated. Ref: ${ref}.`;
      return { subject, html, text };
    }

    case 'VAS_PROCESSING': {
      const subject = `Order In Progress: ${ref} — Supreme Digital Network`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-warning">Processing</span></div>
         <div class="amount">${amt}</div>
         <p>Hello ${name}, your order is currently being processed with the operator.</p>
         <p>Please do NOT repeat the transaction. Our automated reconciliation system is monitoring delivery status and will update your receipt shortly.</p>
         <table class="table-info">
           <tr><td class="label">Order Reference</td><td class="value">${ref}</td></tr>
           <tr><td class="label">Status</td><td class="value">PROCESSING / PENDING</td></tr>
           <tr><td class="label">Date</td><td class="value">${dateStr}</td></tr>
         </table>`,
        subject
      );
      const text = `Your order ${ref} for ${amt} is currently processing. Please do not re-purchase. We will notify you once resolved.`;
      return { subject, html, text };
    }

    case 'VAS_REFUND': {
      const subject = `Wallet Refunded: ${amt} — Supreme Digital Network`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-info">Refund Completed</span></div>
         <div class="amount">${amt}</div>
         <p>Hello ${name}, a compensating refund has been credited back to your Supreme wallet.</p>
         <table class="table-info">
           <tr><td class="label">Refund Amount</td><td class="value">${amt}</td></tr>
           <tr><td class="label">Original Reference</td><td class="value">${ref}</td></tr>
           <tr><td class="label">Reason</td><td class="value">${details.reason || 'Unfulfilled operator transaction'}</td></tr>
           <tr><td class="label">Date</td><td class="value">${dateStr}</td></tr>
         </table>`,
        subject
      );
      const text = `A refund of ${amt} for original order ${ref} has been credited back to your wallet. Reason: ${details.reason || 'Unfulfilled order'}.`;
      return { subject, html, text };
    }

    case 'KYC_SUBMITTED': {
      const subject = `KYC Verification Submitted — Supreme Digital Network`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-info">Under Review</span></div>
         <p>Hello ${name}, your KYC verification documents have been received and submitted for compliance review.</p>
         <table class="table-info">
           <tr><td class="label">Target Tier</td><td class="value">${details.targetTier || 'Tier Upgrade'}</td></tr>
           <tr><td class="label">Verification ID</td><td class="value">${ref}</td></tr>
           <tr><td class="label">Status</td><td class="value">PENDING_REVIEW</td></tr>
         </table>`,
        subject
      );
      const text = `Your KYC verification request for ${details.targetTier} has been submitted for review. Ref: ${ref}.`;
      return { subject, html, text };
    }

    case 'KYC_APPROVED': {
      const subject = `KYC Verified! You are now ${details.newTier || 'Upgraded'} — Supreme`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-success">Verification Approved</span></div>
         <p>Hello ${name}, congratulations! Your KYC verification was approved by our compliance team.</p>
         <table class="table-info">
           <tr><td class="label">New Account Tier</td><td class="value">${details.newTier || 'TIER_2'}</td></tr>
           <tr><td class="label">Verification ID</td><td class="value">${ref}</td></tr>
         </table>
         <p>Your wallet limits and features have been upgraded accordingly.</p>`,
        subject
      );
      const text = `Congratulations ${name}! Your KYC verification was approved. New tier: ${details.newTier}. Ref: ${ref}.`;
      return { subject, html, text };
    }

    case 'KYC_REJECTED': {
      const subject = `KYC Verification Update — Supreme Digital Network`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-danger">Verification Rejected</span></div>
         <p>Hello ${name}, your KYC verification request could not be approved.</p>
         <table class="table-info">
           <tr><td class="label">Reason Code</td><td class="value">${details.rejectionCode || 'REJECTED'}</td></tr>
           <tr><td class="label">Notes</td><td class="value">${details.rejectionNotes || 'Information provided did not match official records.'}</td></tr>
         </table>
         <p>You may resubmit your verification through your Account Settings once corrected.</p>`,
        subject
      );
      const text = `Your KYC verification was not approved. Reason: ${details.rejectionCode}. Please review and resubmit in Account Settings.`;
      return { subject, html, text };
    }

    case 'KYC_ACTION_REQUIRED': {
      const subject = `Action Required: KYC Verification — Supreme Digital Network`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge badge-warning">Action Required</span></div>
         <p>Hello ${name}, additional information is required to complete your KYC verification.</p>
         <div class="token-box" style="border-color: #d97706;">
           <div class="token-title" style="color: #fbbf24;">Instructions</div>
           <div style="color: #f8fafc; font-size: 15px; font-weight: 600;">${details.actionRequired || 'Please provide updated verification documents.'}</div>
         </div>
         <p>Please log in to your Supreme account to update your details.</p>`,
        subject
      );
      const text = `Additional action required for your KYC verification: ${details.actionRequired}. Please log in to update your submission.`;
      return { subject, html, text };
    }

    case 'ACCOUNT_STATUS_CHANGED': {
      const statusStr = details.newStatus || 'UPDATED';
      const badgeClass = statusStr === 'ACTIVE' || statusStr === 'RESTORED' ? 'badge-success' : 'badge-danger';
      const subject = `Security Alert: Account Status Updated (${statusStr}) — Supreme`;
      const html = baseHtmlTemplate(
        `<div style="text-align: center;"><span class="badge ${badgeClass}">${statusStr}</span></div>
         <p>Hello ${name}, your Supreme Digital Network account status has been updated to <strong>${statusStr}</strong>.</p>
         <p>If you have any questions or did not authorize this change, please contact compliance@supremedigitalnetwork.com immediately.</p>`,
        subject
      );
      const text = `Security Alert: Your Supreme account status has been updated to ${statusStr}. Contact support if you have questions.`;
      return { subject, html, text };
    }

    default: {
      const subject = `Notification from Supreme Digital Network`;
      const html = baseHtmlTemplate(
        `<h2>Hello ${name}</h2><p>${input.details?.message || 'You have a new update in your Supreme account.'}</p>`,
        subject
      );
      const text = `Hello ${name}, ${input.details?.message || 'You have a new update in your Supreme account.'}`;
      return { subject, html, text };
    }
  }
}
