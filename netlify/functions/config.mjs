// Öffentliche Werte für die App im Browser (keine Geheimnisse)
import { json } from '../lib/core.mjs';
export default async () => json({ supabaseUrl: process.env.SUPABASE_URL || 'https://welzlrpiseuewrdjhids.supabase.co', supabaseKey: process.env.SUPABASE_PUBLISHABLE_KEY });
export const config = { path: '/api/config' };
