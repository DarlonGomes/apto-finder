// Everything before the list: email OTP login, first-run onboarding (profile ->
// share -> daily-scan criteria) and the search bar to switch, edit and share
// searches. The Gate mounts App only once there is a user with a search.

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FACILITIES, RIO_NEIGHBORHOODS, type Me, type Search, type SearchInput } from "@apto/shared";
import App from "./App";
import {
  createSearch,
  fetchMe,
  inviteMember,
  logout,
  putProfile,
  setActiveSearch,
  startLogin,
  updateSearch,
  verifyLogin,
} from "./api";
import { setPeople } from "./Card";

const input = "border-rule w-full rounded-lg border bg-paper px-3 py-2.5 text-base";
const primary = "w-full rounded-lg bg-ink py-3 text-sm font-semibold text-paper disabled:opacity-50";
const chip = (on: boolean) =>
  `rounded-full border px-3 py-1.5 text-sm ${on ? "border-ink bg-ink text-paper" : "border-rule bg-paper text-ink"}`;

function Screen({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-xl font-semibold">{title}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      <div className="mt-6">{children}</div>
    </div>
  );
}

const Err = ({ e }: { e: unknown }) =>
  e ? <p className="mt-2 text-sm text-flag">{e instanceof Error ? e.message : String(e)}</p> : null;

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="mt-3 block text-sm">
    <span className="font-medium">{label}</span>
    <div className="mt-1">{children}</div>
  </label>
);

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const start = useMutation({ mutationFn: () => startLogin(email), onSuccess: () => setSent(true) });
  const verify = useMutation({ mutationFn: () => verifyLogin(email, code), onSuccess: onDone });
  if (!sent)
    return (
      <Screen title="apto-finder" sub="Entre ou crie sua conta com seu email. Sem senha: mandamos um código.">
        <form onSubmit={(e) => (e.preventDefault(), start.mutate())}>
          <input
            className={input} type="email" autoComplete="email" required autoFocus
            placeholder="voce@email.com" value={email} onChange={(e) => setEmail(e.target.value)}
          />
          <button className={`${primary} mt-3`} disabled={start.isPending}>
            {start.isPending ? "Enviando…" : "Receber código"}
          </button>
          <Err e={start.error} />
        </form>
      </Screen>
    );
  return (
    <Screen title="Digite o código" sub={<>Enviamos 6 dígitos para <b>{email}</b>. Vale por 10 minutos.</>}>
      <form onSubmit={(e) => (e.preventDefault(), verify.mutate())}>
        <input
          className={`${input} tabular text-center text-2xl tracking-[0.5em]`}
          inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus
          value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        <button className={`${primary} mt-3`} disabled={code.length !== 6 || verify.isPending}>
          Entrar
        </button>
        <Err e={verify.error} />
      </form>
      <div className="mt-4 flex justify-between text-sm text-muted">
        <button onClick={() => (setSent(false), setCode(""))}>Trocar email</button>
        <button onClick={() => start.mutate()} disabled={start.isPending}>Reenviar código</button>
      </div>
      <Err e={start.error} />
    </Screen>
  );
}

const REFERRALS = ["Indicação de amigo", "Instagram", "WhatsApp", "Google", "Outro"];

function Profile({ me, onDone }: { me: Me; onDone: () => void }) {
  const [p, setP] = useState({
    first_name: me.first_name ?? "",
    last_name: me.last_name ?? "",
    home_neighborhood: me.home_neighborhood ?? "",
    home_city: me.home_city ?? "Rio de Janeiro",
    referral: me.referral ?? "",
  });
  const save = useMutation({ mutationFn: () => putProfile(p), onSuccess: onDone });
  const set = (k: keyof typeof p) => (e: { target: { value: string } }) => setP({ ...p, [k]: e.target.value });
  return (
    <Screen title="Bem-vindo!" sub="Conta pra gente quem é você.">
      <form onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome *"><input className={input} required autoComplete="given-name" value={p.first_name} onChange={set("first_name")} /></Field>
          <Field label="Sobrenome *"><input className={input} required autoComplete="family-name" value={p.last_name} onChange={set("last_name")} /></Field>
        </div>
        <p className="mt-5 text-sm font-semibold">Onde você mora hoje?</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bairro"><input className={input} value={p.home_neighborhood} onChange={set("home_neighborhood")} /></Field>
          <Field label="Cidade"><input className={input} autoComplete="address-level2" value={p.home_city} onChange={set("home_city")} /></Field>
        </div>
        <Field label="Como conheceu o apto-finder?">
          <select className={input} value={p.referral} onChange={set("referral")}>
            <option value="">escolha…</option>
            {REFERRALS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <button className={`${primary} mt-6`} disabled={save.isPending}>Continuar</button>
        <Err e={save.error} />
      </form>
    </Screen>
  );
}

/** Email list editor, used by onboarding and the share modal. */
function EmailAdder({ onAdd, busy }: { onAdd: (email: string) => void; busy?: boolean }) {
  const [email, setEmail] = useState("");
  return (
    <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), onAdd(email.trim().toLowerCase()), setEmail(""))}>
      <input className={input} type="email" required placeholder="email da pessoa" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="rounded-lg border border-ink px-4 text-sm font-medium" disabled={busy}>Adicionar</button>
    </form>
  );
}

function Share({ onNext }: { onNext: (emails: string[]) => void }) {
  const [emails, setEmails] = useState<string[]>([]);
  return (
    <Screen
      title="Vai procurar com alguém?"
      sub="Quem mora junto (casal, família, amigos) pode dividir a mesma busca: vocês veem os mesmos imóveis, curtidas, visitas e notas."
    >
      <EmailAdder onAdd={(e) => !emails.includes(e) && setEmails([...emails, e])} />
      <ul className="mt-3 space-y-1 text-sm">
        {emails.map((e) => (
          <li key={e} className="flex justify-between">
            {e}
            <button className="text-muted" onClick={() => setEmails(emails.filter((x) => x !== e))}>remover</button>
          </li>
        ))}
      </ul>
      <button className={`${primary} mt-6`} onClick={() => onNext(emails)}>
        {emails.length ? "Continuar" : "Agora não, buscar sozinho"}
      </button>
      <p className="mt-2 text-center text-xs text-muted">Eles recebem um email e entram com o próprio endereço.</p>
    </Screen>
  );
}

const EMPTY: SearchInput = {
  name: "", neighborhoods: [], total_min_cents: null, total_max_cents: null,
  bedrooms_min: null, bathrooms_min: null, parking_min: null,
  pets: "any", furnished: "any", facilities: [],
};
const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
// Whole reais in the UI, integer cents everywhere else.
const reais = (c: number | null) => (c == null ? "" : String(c / 100));
const cents = (v: string) => (v.trim() === "" ? null : Math.round(Number(v)) * 100);

function SearchForm({
  initial = EMPTY, submitLabel, onSubmit, busy, error,
}: {
  initial?: SearchInput; submitLabel: string; onSubmit: (s: SearchInput) => void; busy: boolean; error: unknown;
}) {
  const [s, setS] = useState<SearchInput>(initial);
  const [hoodFilter, setHoodFilter] = useState("");
  const set = <K extends keyof SearchInput>(k: K, v: SearchInput[K]) => setS({ ...s, [k]: v });
  const fold = (x: string) => x.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const hoods = RIO_NEIGHBORHOODS.filter((h) => fold(h).includes(fold(hoodFilter)));
  const minSelect = (label: string, k: "bedrooms_min" | "bathrooms_min" | "parking_min", opts: number[]) => (
    <Field label={label}>
      <select className={input} value={String(s[k] ?? "")} onChange={(e) => set(k, e.target.value ? Number(e.target.value) : null)}>
        <option value="">qualquer</option>
        {opts.map((n) => <option key={n} value={n}>{n}+</option>)}
      </select>
    </Field>
  );
  return (
    <form onSubmit={(e) => (e.preventDefault(), onSubmit(s))}>
      <Field label="Nome da busca">
        <input className={input} placeholder="Minha busca" value={s.name} onChange={(e) => set("name", e.target.value)} />
      </Field>

      <p className="mt-5 text-sm font-semibold">Bairros * <span className="font-normal text-muted">({s.neighborhoods.length} escolhidos)</span></p>
      <input className={`${input} mt-2`} placeholder="filtrar bairros" value={hoodFilter} onChange={(e) => setHoodFilter(e.target.value)} />
      <div className="mt-2 flex max-h-56 flex-wrap gap-2 overflow-y-auto">
        {hoods.map((h) => (
          <button type="button" key={h} className={chip(s.neighborhoods.includes(h))} onClick={() => set("neighborhoods", toggle(s.neighborhoods, h))}>
            {h}
          </button>
        ))}
      </div>

      <p className="mt-5 text-sm font-semibold">Custo total mensal (aluguel + condomínio + IPTU)</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Mínimo (R$)"><input className={input} inputMode="numeric" placeholder="sem mínimo" value={reais(s.total_min_cents)} onChange={(e) => set("total_min_cents", cents(e.target.value.replace(/\D/g, "")))} /></Field>
        <Field label="Máximo (R$)"><input className={input} inputMode="numeric" placeholder="sem máximo" value={reais(s.total_max_cents)} onChange={(e) => set("total_max_cents", cents(e.target.value.replace(/\D/g, "")))} /></Field>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {minSelect("Quartos", "bedrooms_min", [1, 2, 3, 4])}
        {minSelect("Banheiros", "bathrooms_min", [1, 2, 3])}
        {minSelect("Vagas", "parking_min", [1, 2, 3])}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Pets">
          <select className={input} value={s.pets} onChange={(e) => set("pets", e.target.value as SearchInput["pets"])}>
            <option value="any">não tenho pet</option>
            <option value="unknown_ok">tenho pet (esconder quem recusa)</option>
            <option value="required">só onde aceitam com certeza</option>
          </select>
        </Field>
        <Field label="Mobília">
          <select className={input} value={s.furnished} onChange={(e) => set("furnished", e.target.value as SearchInput["furnished"])}>
            <option value="any">tanto faz</option>
            <option value="yes">mobiliado</option>
            <option value="no">sem mobília</option>
          </select>
        </Field>
      </div>

      <p className="mt-5 text-sm font-semibold">O prédio precisa ter</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.entries(FACILITIES).map(([k, f]) => (
          <button type="button" key={k} className={chip(s.facilities.includes(k))} onClick={() => set("facilities", toggle(s.facilities, k))}>
            {f.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">Só aparece quem anuncia a comodidade; muitos anúncios não informam.</p>

      <button className={`${primary} mt-6`} disabled={busy || s.neighborhoods.length === 0}>{submitLabel}</button>
      <Err e={error} />
    </form>
  );
}

function Onboarding({ onDone }: { onDone: (id: string) => void }) {
  const [invite, setInvite] = useState<string[] | null>(null);
  const create = useMutation({ mutationFn: (s: SearchInput) => createSearch({ ...s, invite: invite ?? [] }), onSuccess: (r) => onDone(r.id) });
  if (invite === null) return <Share onNext={setInvite} />;
  return (
    <Screen
      title="Sua varredura diária"
      sub="Todo dia olhamos os principais portais (VivaReal, ZAP, OLX, QuintoAndar) com os critérios abaixo e juntamos tudo numa lista só, com o custo total real. Só os bairros são obrigatórios; dá pra mudar tudo depois."
    >
      <SearchForm submitLabel="Começar a busca" onSubmit={create.mutate} busy={create.isPending} error={create.error} />
    </Screen>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/30" />
      <div
        className="border-rule relative max-h-[90vh] w-full overflow-y-auto rounded-t-xl border-t bg-paper p-4 pb-6 md:max-w-md md:rounded-xl md:border md:p-6 md:shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-semibold">{title}</p>
          <button onClick={onClose} aria-label="fechar" className="px-2 text-lg">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SearchBar({ me, search, onSwitch }: { me: Me; search: Search; onSwitch: (id: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<"edit" | "new" | "share" | null>(null);
  const done = () => (setOpen(null), qc.invalidateQueries({ queryKey: ["me"] }));
  const edit = useMutation({
    mutationFn: (s: SearchInput) => updateSearch(search.id, s),
    onSuccess: () => (done(), qc.invalidateQueries()), // new criteria: refetch everything
  });
  const create = useMutation({
    mutationFn: (s: SearchInput) => createSearch({ ...s, invite: [] }),
    onSuccess: (r) => (done(), onSwitch(r.id)),
  });
  const add = useMutation({ mutationFn: (e: string) => inviteMember(search.id, e), onSuccess: done });
  const btn = "px-1.5 py-1 text-xs text-muted hover:text-ink";
  return (
    <div className="border-rule flex items-center gap-1 border-b px-4 py-1.5">
      <select
        className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium"
        value={search.id}
        onChange={(e) => (e.target.value === "+" ? setOpen("new") : onSwitch(e.target.value))}
      >
        {me.searches.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        <option value="+">+ nova busca</option>
      </select>
      <button className={btn} onClick={() => setOpen("edit")}>✏️ critérios</button>
      <button className={btn} onClick={() => setOpen("share")}>👥 {search.members.length}</button>
      <button className={btn} onClick={() => logout().then(() => location.assign("/"))}>sair</button>

      {open === "edit" && (
        <Modal title="Critérios da busca" onClose={() => setOpen(null)}>
          <SearchForm initial={search} submitLabel="Salvar" onSubmit={edit.mutate} busy={edit.isPending} error={edit.error} />
        </Modal>
      )}
      {open === "new" && (
        <Modal title="Nova busca" onClose={() => setOpen(null)}>
          <SearchForm submitLabel="Criar busca" onSubmit={create.mutate} busy={create.isPending} error={create.error} />
        </Modal>
      )}
      {open === "share" && (
        <Modal title="Quem participa" onClose={() => setOpen(null)}>
          <ul className="my-3 space-y-1 text-sm">
            {search.members.map((m) => (
              <li key={m.email}>
                {m.first_name ?? <span className="text-muted">(ainda não entrou)</span>} <span className="text-muted">{m.email}</span>
              </li>
            ))}
          </ul>
          <EmailAdder onAdd={(e) => add.mutate(e)} busy={add.isPending} />
          <Err e={add.error} />
        </Modal>
      )}
    </div>
  );
}

const LAST = "lastSearch";

export default function Gate() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: fetchMe, staleTime: Infinity });
  const [picked, setPicked] = useState<string | null>(() => {
    try {
      return new URLSearchParams(location.search).get("search") ?? localStorage.getItem(LAST);
    } catch {
      return null;
    }
  });
  const refetch = () => me.refetch();

  if (me.isLoading) return <p className="p-4 text-sm text-muted">Carregando…</p>;
  if (me.isError) return <p className="p-4 text-sm text-flag">API fora do ar.</p>;
  if (!me.data) return <Login onDone={refetch} />;
  if (!me.data.first_name) return <Profile me={me.data} onDone={refetch} />;
  if (me.data.searches.length === 0)
    return <Onboarding onDone={(id) => (setPicked(id), refetch())} />;

  const search = me.data.searches.find((s) => s.id === picked) ?? me.data.searches[0]!;
  setActiveSearch(search.id);
  setPeople(me.data.searches.flatMap((s) => s.members));
  const onSwitch = (id: string) => {
    try {
      localStorage.setItem(LAST, id);
    } catch {
      /* private mode */
    }
    // Statuses and notes differ per search: drop every cached unit query.
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" });
    history.replaceState(null, "", `?search=${id}`);
    setPicked(id);
  };
  return (
    <>
      <SearchBar me={me.data} search={search} onSwitch={onSwitch} />
      <App key={search.id} />
    </>
  );
}
