import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';

// Criptografia simétrica pra guardar segredos de terceiro (ex.: chave de API
// de LLM que o cliente cola nas Configurações) dentro da coluna de texto da
// tabela `settings`, em vez de texto puro — evita que um dump/leak do banco
// exponha a chave da conta dele.
const ALGO = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      'SETTINGS_ENCRYPTION_KEY não configurada no .env — necessária pra guardar segredos (chave de API de terceiro) com segurança.',
    );
  }
  return scryptSync(secret, 'convertHairCrmMarcel-settings', 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, enc].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, encB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('Payload criptografado inválido');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const enc = Buffer.from(encB64, 'base64');
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// Prévia segura pra exibir no frontend sem nunca devolver a chave inteira
// (ex.: "sk-p...9f3a").
export function maskSecretPreview(plain: string): string {
  if (plain.length <= 8) return '••••';
  return `${plain.slice(0, 4)}...${plain.slice(-4)}`;
}
