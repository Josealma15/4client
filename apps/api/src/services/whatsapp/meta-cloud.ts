import { decryptSecret } from '../../lib/crypto.js';

const META_API_BASE = 'https://graph.facebook.com/v22.0';

export class MetaCloudProvider {
  constructor(
    private readonly phoneNumberId: string,
    private readonly accessToken: string,
  ) {}

  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    const res = await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Meta API sendText failed (${res.status}): ${JSON.stringify(err)}`);
    }

    const data = await res.json() as { messages: [{ id: string }] };
    return { messageId: data.messages[0].id };
  }

  async markAsRead(messageId: string): Promise<void> {
    await fetch(`${META_API_BASE}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    }).catch(() => {}); // non-critical, best effort
  }

  static fromOrg(org: { wpp_meta_phone_id: string | null; wpp_meta_token: string | null }): MetaCloudProvider | null {
    if (!org.wpp_meta_phone_id || !org.wpp_meta_token) return null;
    const token = decryptSecret(org.wpp_meta_token);
    if (!token) return null;
    return new MetaCloudProvider(org.wpp_meta_phone_id, token);
  }
}
