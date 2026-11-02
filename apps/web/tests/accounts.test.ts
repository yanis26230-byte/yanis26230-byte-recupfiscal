import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptInvitation, changeMemberRole, claimPendingAudits, getCompanyView, inspectInvitation, inviteMember, listMyAudits, listMyCompanies,
  listPendingCompanyAccess, NotFound, removeMember, revokeInvitation,
} from '@/lib/account-service';
import { AccessDenied, captureLead, createAudit, getResults, loadAudit, saveStep, submitAudit, ValidationError } from '@/lib/audit-service';
import { consumeMagicLink, createMagicLink, inspectMagicLink, MAX_LINKS_PER_HOUR, revokeSession, safeNextPath, sessionUser, type AuthUser } from '@/lib/auth/local-core';
import { createDatabase, type Database } from '@/lib/db/database';
import { outboxMailer, type Mailer } from '@/lib/mail';
import { CONSENT_TEXT_VERSION } from '@/lib/questionnaire';

let db: Database;
let mailer: Mailer;
beforeAll(async () => { db = await createDatabase({ pgliteDataDir: null }); mailer = outboxMailer(db); });
afterAll(async () => db?.close());

async function login(email: string): Promise<AuthUser & { session: string }> {
  const l = await createMagicLink(db, email, '/espace');
  if ('rateLimited' in l) throw new Error('limite');
  const r = (await consumeMagicLink(db, l.token))!;
  return { ...r.user, session: r.sessionToken };
}

const company = (siren: string, name: string) => ({ siren, legalName: name, legalForm: 'SARL', nafCode: '43.22A', sector: 'batiment' as const, createdOn: null, headcountRange: null, source: 'manuel' as const });
const est = (siret: string | null) => [{ key: 'e1', siret, address: '1 rue X', postalCode: '26000', city: 'Valence', inseeCode: '26362', concerned: true }];

async function completeAudit(auditId: string, token: string) {
  const { filled } = await loadAudit(db, auditId, { token });
  for (const y of Object.keys(filled.entreprise.headcountByYear)) {
    filled.entreprise.headcountByYear[y] = 5;
    filled.salaires.years[y]!.brackets.lt_1_1 = { count: 5, partTimeSharePct: 0, partTimeRatioPct: null };
  }
  filled.recapitulatif = { consent: true, consentTextVersion: CONSENT_TEXT_VERSION };
  for (const s of ['entreprise', 'salaires', 'recapitulatif'] as const) await saveStep(db, auditId, { token }, s, filled[s]);
  await submitAudit(db, auditId, { token }, '2026-11-02');
}

describe('Lien magique local', () => {
  it('jeton haché, à usage unique, crée l’utilisateur et une session', async () => {
    const l = await createMagicLink(db, ' Jean@Exemple.FR ', '/espace');
    if ('rateLimited' in l) throw new Error();
    const stored = await db.query<{ token_hash: string; email: string }>(`select token_hash, email from local_auth.magic_links`);
    expect(stored[0]!.token_hash).not.toBe(l.token);
    expect(stored[0]!.email).toBe('jean@exemple.fr');
    expect(await inspectMagicLink(db, l.token)).toMatchObject({ valid: true, email: 'jean@exemple.fr' });
    // Consultation (GET) sans consommation : toujours valable.
    expect(await inspectMagicLink(db, l.token)).toMatchObject({ valid: true });
    const r = await consumeMagicLink(db, l.token);
    expect(r!.user.email).toBe('jean@exemple.fr');
    expect(await consumeMagicLink(db, l.token)).toBeNull();
    expect(await inspectMagicLink(db, l.token)).toEqual({ valid: false, reason: 'utilise' });
    const profile = await db.query(`select 1 from public.users where id = $1`, [r!.user.id]);
    expect(profile).toHaveLength(1);
    expect((await sessionUser(db, r!.sessionToken))!.id).toBe(r!.user.id);
    await revokeSession(db, r!.sessionToken);
    expect(await sessionUser(db, r!.sessionToken)).toBeNull();
  });
  it('lien expiré refusé ; reconnexion = même utilisateur', async () => {
    const l = await createMagicLink(db, 'jean@exemple.fr', '/espace');
    if ('rateLimited' in l) throw new Error();
    await db.query(`update local_auth.magic_links set expires_at = now() - interval '1 minute' where used_at is null`);
    expect(await inspectMagicLink(db, l.token)).toEqual({ valid: false, reason: 'expire' });
    expect(await consumeMagicLink(db, l.token)).toBeNull();
    const a = await login('jean@exemple.fr');
    const b = await login('JEAN@exemple.fr');
    expect(a.id).toBe(b.id);
  });
  it('limite de demandes par adresse', async () => {
    for (let i = 0; i < MAX_LINKS_PER_HOUR; i++) await createMagicLink(db, 'spam@exemple.fr', '/');
    expect(await createMagicLink(db, 'spam@exemple.fr', '/')).toEqual({ rateLimited: true });
  });
  it('redirection uniquement vers un chemin interne', () => {
    expect(safeNextPath('/espace?x=1')).toBe('/espace?x=1');
    for (const bad of ['https://evil.fr', '//evil.fr', '/\\evil.fr', null, 'espace']) expect(safeNextPath(bad as string)).toBe('/espace');
  });
});

describe('Rattachement de l’audit après connexion (critère 3)', () => {
  let alice: AuthUser; let auditId: string; let token: string; let companyId: string;
  it('le prospect crée une réclamation ; le lien magique crée le compte, l’entreprise et rattache l’audit', async () => {
    ({ auditId, token } = await createAudit(db, { company: company('552100554', 'Alpha SARL'), establishments: est('55210055400013'), today: '2026-11-02' }));
    await completeAudit(auditId, token);
    await captureLead(db, auditId, { token }, { email: 'alice@alpha.fr', firstName: 'Alice', phone: '', consent: true });
    alice = await login('Alice@Alpha.fr');
    const claims = await claimPendingAudits(db, alice);
    expect(claims).toEqual([{ auditId, outcome: 'entreprise_creee', companyName: 'Alpha SARL' }]);
    const companies = await listMyCompanies(db, alice.id);
    expect(companies).toMatchObject([{ siren: '552100554', role: 'proprietaire', verification_status: 'non_verifiee' }]);
    companyId = companies[0]!.id;
    const [lead] = await db.query<{ status: string; user_id: string }>(`select status::text, user_id::text from leads where email = 'alice@alpha.fr'`);
    expect(lead).toEqual({ status: 'compte_cree', user_id: alice.id });
    expect(await claimPendingAudits(db, alice)).toEqual([]); // une seule fois
  });
  it('sur un autre appareil (sans jeton), le compte retrouve l’audit et le détail des résultats (critère 4)', async () => {
    const audits = await listMyAudits(db, alice.id);
    expect(audits.map((a) => [a.id, a.company_id])).toEqual([[auditId, companyId]]);
    const r = await getResults(db, auditId, { userId: alice.id });
    expect(r!.viaAccount).toBe(true);
    expect(r!.detailAllowed).toBe(true);
    // Sans compte, le jeton seul ne donne pas le détail.
    expect((await getResults(db, auditId, { token }))!.detailAllowed).toBe(false);
  });
  it('un autre compte ne peut ni lire ni modifier l’audit (critère 5)', async () => {
    const mallory = await login('mallory@x.fr');
    await expect(loadAudit(db, auditId, { userId: mallory.id })).rejects.toBeInstanceOf(AccessDenied);
    await expect(getCompanyView(db, mallory.id, companyId)).rejects.toBeInstanceOf(NotFound);
    expect(await listMyAudits(db, mallory.id)).toEqual([]);
    // Réclamation avec une autre adresse : rien n'est rattaché.
    expect(await claimPendingAudits(db, mallory)).toEqual([]);
  });
  it('un visiteur qui saisit le SIREN d’une entreprise existante ne la rejoint pas', async () => {
    const r = await createAudit(db, { company: company('552100554', 'Alpha usurpée'), establishments: est(null), today: '2026-11-02' });
    await completeAudit(r.auditId, r.token);
    await captureLead(db, r.auditId, { token: r.token }, { email: 'eve@x.fr', firstName: 'Eve', phone: '', consent: true });
    const eve = await login('eve@x.fr');
    expect((await claimPendingAudits(db, eve))[0]!.outcome).toBe('entreprise_existante_non_membre');
    expect(await listMyCompanies(db, eve.id)).toEqual([]);
    expect(await listPendingCompanyAccess(db, eve.id)).toHaveLength(1);
    // Son audit reste personnel et invisible pour Alpha.
    expect((await listMyAudits(db, alice.id)).map((a) => a.id)).not.toContain(r.auditId);
    expect((await listMyAudits(db, eve.id))[0]!.company_id).toBeNull();
  });
  it('un utilisateur connecté qui démarre un audit pour son entreprise l’y rattache directement', async () => {
    const r = await createAudit(db, { company: company('552100554', 'Alpha SARL'), establishments: est('55210055400013'), today: '2026-11-02', ownerUserId: alice.id });
    const [a] = await db.query<{ company_id: string; owner_user_id: string }>(`select company_id::text, owner_user_id::text from audits where id = $1`, [r.auditId]);
    expect(a).toEqual({ company_id: companyId, owner_user_id: alice.id });
  });

  describe('Membres et invitations', () => {
    let bob: AuthUser; let inviteUrl: string;
    it('le propriétaire invite ; l’e-mail contient un lien à usage réservé', async () => {
      ({ url: inviteUrl } = await inviteMember(db, mailer, alice, companyId, { email: 'Bob@Compta.fr', role: 'comptable_invite' }, 'http://test'));
      const [mail] = await db.query<{ to_email: string; text_body: string }>(`select to_email, text_body from local_auth.outbox order by id desc limit 1`);
      expect(mail!.to_email).toBe('bob@compta.fr');
      expect(mail!.text_body).toContain(inviteUrl);
      const tokenHashStored = await db.query<{ token_hash: string }>(`select token_hash from invitations`);
      expect(inviteUrl).not.toContain(tokenHashStored[0]!.token_hash);
      await expect(inviteMember(db, mailer, alice, companyId, { email: 'bob@compta.fr', role: 'collaborateur' }, 'http://test')).rejects.toThrow(/déjà en attente/);
    });
    it('l’invitation est réservée à l’adresse invitée', async () => {
      const t = inviteUrl.split('/').pop()!;
      const eve = await login('eve@x.fr');
      await expect(acceptInvitation(db, eve, t)).rejects.toThrow(/réservée à bob@compta.fr/);
      bob = await login('bob@compta.fr');
      expect(await inspectInvitation(db, t)).toMatchObject({ status: 'valide', companyName: 'Alpha SARL', role: 'comptable_invite' });
      await acceptInvitation(db, bob, t);
      expect(await inspectInvitation(db, t)).toMatchObject({ status: 'acceptee' });
      await expect(acceptInvitation(db, bob, t)).rejects.toThrow(/plus valable/);
    });
    it('le comptable invité lit l’entreprise et les résultats, sans pouvoir modifier ni inviter', async () => {
      const v = await getCompanyView(db, bob.id, companyId);
      expect(v.myRole).toBe('comptable_invite');
      expect(v.members.map((m) => m.email).sort()).toEqual(['alice@alpha.fr', 'bob@compta.fr']);
      expect(v.invitations).toEqual([]); // invitations visibles du seul propriétaire
      expect((await getResults(db, auditId, { userId: bob.id }))!.detailAllowed).toBe(true);
      const { filled } = await loadAudit(db, auditId, { userId: bob.id });
      await expect(saveStep(db, auditId, { userId: bob.id }, 'salaires', filled.salaires)).rejects.toBeInstanceOf(ValidationError);
      await expect(inviteMember(db, mailer, bob, companyId, { email: 'z@x.fr', role: 'collaborateur' }, 'http://test')).rejects.toThrow(/propriétaire/);
    });
    it('rôles : seul un propriétaire modifie ; jamais d’entreprise sans propriétaire', async () => {
      await expect(changeMemberRole(db, bob.id, companyId, bob.id, 'proprietaire')).rejects.toThrow(/propriétaire/);
      await expect(removeMember(db, alice.id, companyId, alice.id)).rejects.toThrow(/au moins un propriétaire/);
      await changeMemberRole(db, alice.id, companyId, bob.id, 'collaborateur');
      expect((await getCompanyView(db, bob.id, companyId)).myRole).toBe('collaborateur');
      await removeMember(db, alice.id, companyId, bob.id);
      await expect(getCompanyView(db, bob.id, companyId)).rejects.toBeInstanceOf(NotFound);
    });
    it('invitation annulée ou expirée inutilisable', async () => {
      const { url } = await inviteMember(db, mailer, alice, companyId, { email: 'carl@x.fr', role: 'collaborateur' }, 'http://test');
      const v = await getCompanyView(db, alice.id, companyId);
      await revokeInvitation(db, alice.id, v.invitations[0]!.id);
      const carl = await login('carl@x.fr');
      await expect(acceptInvitation(db, carl, url.split('/').pop()!)).rejects.toThrow(/plus valable/);
      const { url: url2 } = await inviteMember(db, mailer, alice, companyId, { email: 'carl@x.fr', role: 'collaborateur' }, 'http://test');
      await db.query(`update invitations set expires_at = now() - interval '1 day' where accepted_at is null and revoked_at is null`);
      expect((await inspectInvitation(db, url2.split('/').pop()!)).status).toBe('expiree');
    });
  });
});

describe('Amorçage du premier administrateur', () => {
  it('uniquement pour une adresse listée et tant qu’aucun administrateur n’existe', async () => {
    const { bootstrapAdmin } = await import('@/lib/account-service');
    const x = await login('boot@p.fr');
    const y = await login('boot2@p.fr');
    expect(await bootstrapAdmin(db, x, 'autre@p.fr')).toBe(false);
    expect(await bootstrapAdmin(db, x, 'BOOT@p.fr, boot2@p.fr')).toBe(true);
    expect(await bootstrapAdmin(db, y, 'boot@p.fr,boot2@p.fr')).toBe(false); // un administrateur existe déjà
    const roles = await db.query<{ email: string; internal_role: string | null }>(`select email, internal_role::text from users where email like 'boot%' order by email`);
    expect(roles).toEqual([{ email: 'boot2@p.fr', internal_role: null }, { email: 'boot@p.fr', internal_role: 'administrateur' }]);
  });
});
