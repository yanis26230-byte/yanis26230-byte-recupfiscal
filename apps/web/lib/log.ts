/**
 * Journalisation structurée (une ligne JSON par événement), lisible par tout collecteur
 * (Better Stack, Datadog, Grafana Loki…). Jamais de donnée personnelle ni de montant dans les messages.
 */
type Level = 'info' | 'warn' | 'error';
function write(level: Level, msg: string, ctx: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...ctx });
  (level === 'error' ? console.error : console.log)(line);
}
export const log = {
  info: (msg: string, ctx?: Record<string, unknown>) => write('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write('warn', msg, ctx),
  error: (msg: string, err?: unknown, ctx?: Record<string, unknown>) =>
    write('error', msg, { ...ctx, error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 5).join(' | ') } : String(err) }),
};
