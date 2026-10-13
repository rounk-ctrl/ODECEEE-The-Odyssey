import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

// All logic lives in database RPC functions; the browser only calls them.
async function rpc<T = any>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// Re-run `load` whenever any crew or ledger row changes.
function usePulse(load: () => void) {
  useEffect(() => {
    load();
    const ch = supabase
      .channel("pulse-" + Math.random())
      .on("postgres_changes", { event: "*", schema: "public", table: "pulse" }, () => load())
      .subscribe();
    const iv = setInterval(load, 15000);
    return () => {
      clearInterval(iv);
      supabase.removeChannel(ch);
    };
  }, [load]);
}

const fmtTime = (t?: string | null) =>
  t
    ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "—";

type Session = { role: "crew" | "keeper" | "admin"; secret: string };

export function Quest() {
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => {
    const raw = localStorage.getItem("quest-session");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Session;
      if (
        (parsed.role === "crew" || parsed.role === "keeper" || parsed.role === "admin") &&
        typeof parsed.secret === "string"
      )
        setS(parsed);
      else localStorage.removeItem("quest-session");
    } catch {
      localStorage.removeItem("quest-session");
    }
  }, []);
  const save = (v: Session | null) => {
    if (v) localStorage.setItem("quest-session", JSON.stringify(v));
    else localStorage.removeItem("quest-session");
    setS(v);
  };
  return (
    <div className="min-h-screen">
      <div className="meander" />
      <main className="mx-auto max-w-3xl px-4 pb-16 sm:px-6">
        <header className="quest-header py-6 text-center">
          <img className="brand-logo brand-logo-left" src={`${import.meta.env.BASE_URL}college-logo.png`} alt="College logo" />
          <div className="brand-title">
            <div className="label">Odeceee</div>
            <h1 className="text-3xl tracking-wide">The Circuit Quest</h1>
          </div>
          <img className="brand-logo brand-logo-right" src={`${import.meta.env.BASE_URL}club-logo.png`} alt="Club logo" />
          <div className="double-rule mt-4" />
        </header>
        {!s && <Login onIn={save} />}
        {s?.role === "crew" && <Crew token={s.secret} onOut={() => save(null)} />}
        {s && s.role !== "crew" && <Staff pass={s.secret} admin={s.role === "admin"} />}
        {s && (
          <div className="mt-10 text-center">
            <button className="label underline" onClick={() => save(null)}>
              Depart
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function Login({ onIn }: { onIn: (s: Session) => void }) {
  const [tab, setTab] = useState<Session["role"]>("crew");
  const [val, setVal] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      if (tab === "crew")
        onIn({ role: "crew", secret: await rpc<string>("crew_login", { p_code: val }) });
      else if (await rpc<boolean>("staff_login", { p_role: tab, p_pass: val }))
        onIn({ role: tab, secret: val });
      else setErr("That word is not known.");
    } catch (e) {
      setErr(
        e instanceof Error && e.message.includes("That code is not known")
          ? "That code is not known."
          : "The gate could not be reached. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <div className="grid grid-cols-3 border">
        {(["crew", "keeper", "admin"] as const).map((t, i) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              setVal("");
              setErr("");
            }}
            className={`min-h-12 ${i ? "border-l" : ""} ${tab === t ? "bg-foreground text-background" : ""}`}
            style={{ fontVariant: "small-caps", letterSpacing: "0.06em" }}
          >
            {t}
          </button>
        ))}
      </div>
      <form onSubmit={go} className="mt-6 space-y-4">
        <label className="label block">
          {tab === "crew" ? "Thy crew's code" : `The ${tab}'s password`}
        </label>
        <input
          className="field"
          type={tab === "crew" ? "text" : "password"}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoCapitalize="characters"
        />
        {err && <p className="text-primary">{err}</p>}
        <button className="btn btn-accent w-full" disabled={busy || !val}>
          Embark
        </button>
      </form>
    </section>
  );
}

function Crew({ token, onOut }: { token: string; onOut: () => void }) {
  const [st, setSt] = useState<any>(null);
  const [word, setWord] = useState("");
  const [msg, setMsg] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const load = useCallback(() => {
    rpc("crew_state", { p_token: token })
      .then((state) => {
        setSt(state);
        setLoadError(false);
      })
      .catch(() => setLoadError(true));
  }, [token]);
  usePulse(load);
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  if (!st)
    return (
      <div className="py-8 text-center">
        <p className="label">{loadError ? "The stars are obscured." : "Reading the stars…"}</p>
        {loadError && (
          <button className="btn mt-4" onClick={load}>
            Try again
          </button>
        )}
      </div>
    );
  if (st.displaced)
    return (
      <div className="border p-6 text-center">
        <p className="text-xl">This crew is active on another device.</p>
        <button className="btn mt-6" onClick={onOut}>
          Return
        </button>
      </div>
    );

  const lockLeft = st.locked_until
    ? Math.ceil((new Date(st.locked_until).getTime() - now) / 1000)
    : 0;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg("");
    try {
      const r = await rpc<string>("crew_submit", { p_token: token, p_word: word });
      setWord("");
      setMsg(
        r === "wrong"
          ? "That word is not known."
          : r === "locked"
            ? "Thy crew is lost: wait 30 seconds."
            : "",
      );
      load();
    } catch {
      setMsg("The Keeper could not be reached. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      {loadError && (
        <p className="mb-4 border border-primary p-3 text-center text-primary" role="status">
          The signal is lost; seeking the stars again.
        </p>
      )}
      <div className="flex items-baseline justify-between border-b pb-2">
        <h2 className="text-2xl">{st.name}</h2>
        <span className="mono">{st.score} pts</span>
      </div>
      {st.finished_at ? (
        <div className="py-10 text-center">
          <div className="label">Island 7 of 7</div>
          <p className="mt-3 text-4xl">Ithaca reached</p>
          <div className="double-rule my-6" />
          <p className="mono">Final score {st.score}</p>
          <p className="mono">Arrived {fmtTime(st.finished_at)}</p>
        </div>
      ) : (
        <>
          <div className="py-8 text-center">
            <div className="label">Island {st.step} of 7</div>
            <p className="mt-3 text-4xl">{st.theme}</p>
            <p className="mt-2 mono text-lg">Coordinates: {st.coords}</p>
          </div>
          <div className="double-rule" />
          {st.awaiting ? (
            <p className="py-8 text-center text-xl italic">Awaiting the Keeper's judgment</p>
          ) : (
            <form onSubmit={submit} className="space-y-4 pt-6">
              <label className="label block">Enter the Keeper's word</label>
              <input
                className="field"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                disabled={lockLeft > 0 || submitting}
                autoCapitalize="characters"
                autoComplete="off"
              />
              {lockLeft > 0 ? (
                <p className="text-primary">Thy crew is lost: wait {lockLeft} seconds.</p>
              ) : (
                msg && <p className="text-primary">{msg}</p>
              )}
              <button
                className="btn btn-accent w-full"
                disabled={!word || lockLeft > 0 || submitting}
              >
                {submitting ? "Speaking…" : "Speak"}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function H({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-10 mb-3 border-b pb-1 text-2xl" style={{ fontVariant: "small-caps" }}>
      {children}
    </h2>
  );
}

function Staff({ pass, admin }: { pass: string; admin: boolean }) {
  const [q, setQ] = useState<any>({ awaiting: [], astray: [] });
  const [board, setBoard] = useState<any[]>([]);
  const [ad, setAd] = useState<any>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => {
    rpc("keeper_queue", { p_pass: pass })
      .then(setQ)
      .catch((e) => setErr(e.message));
    rpc("ledger_board", { p_pass: pass })
      .then(setBoard)
      .catch(() => {});
    if (admin)
      rpc("admin_data", { p_pass: pass })
        .then(setAd)
        .catch(() => {});
  }, [pass, admin]);
  usePulse(load);
  const act = async (fn: string, args: Record<string, unknown>) => {
    setErr("");
    try {
      await rpc(fn, { p_pass: pass, ...args });
      load();
      return true;
    } catch (e: any) {
      setErr(
        e.message === "denied" ? "Thy password is no longer known. Depart and return." : e.message,
      );
      return false;
    }
  };

  return (
    <section>
      <div className="label text-center">{admin ? "Admin" : "Keeper"}</div>
      {err && <p className="mt-3 border border-primary p-2 text-primary">{err}</p>}

      <H>Awaiting judgment</H>
      {q.awaiting.length === 0 && <p className="italic">None await.</p>}
      {q.awaiting.map((c: any) => (
        <Judge key={c.id} c={c} act={act} />
      ))}

      {q.astray.length > 0 && (
        <>
          <H>Astray</H>
          {q.astray.map((c: any) => (
            <div key={c.id} className="flex items-center justify-between gap-3 border-b py-3">
              <div>
                <div className="text-xl">{c.name}</div>
                <div className="label">
                  At {c.decoy}
                  {c.arrived ? " · has arrived" : ""}
                </div>
              </div>
              <button className="btn" onClick={() => act("keeper_return", { p_team: c.id })}>
                Return to Siren
              </button>
            </div>
          ))}
        </>
      )}

      <H>The Ledger</H>
      <Board rows={board} />

      <H>Add or deduct points</H>
      <Adjust crews={board} act={act} />

      {admin && ad && <Admin pass={pass} ad={ad} board={board} act={act} />}
    </section>
  );
}

function Judge({ c, act }: { c: any; act: (f: string, a: any) => Promise<boolean> }) {
  const [pts, setPts] = useState("100");
  return (
    <div className="border-b py-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xl">{c.name}</span>
        <span className="label">
          Island {c.step} · {c.island}
        </span>
      </div>
      <div className="mt-2 flex gap-2">
        <input
          className="field"
          type="number"
          value={pts}
          onChange={(e) => setPts(e.target.value)}
        />
        <button
          className="btn btn-accent"
          onClick={() => act("keeper_grant", { p_team: c.id, p_points: parseInt(pts || "0", 10) })}
        >
          Grant
        </button>
      </div>
      {c.island === "Siren" && (
        <button className="btn mt-2 w-full" onClick={() => act("keeper_astray", { p_team: c.id })}>
          Send astray
        </button>
      )}
    </div>
  );
}

function Board({ rows }: { rows: any[] }) {
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th>No.</th>
          <th>Crew</th>
          <th className="num">Points</th>
          <th className="num">Isl.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="mono">{r.rank}</td>
            <td>
              {r.name}
              {r.winner && <span className="label ml-2 text-primary">Winner</span>}
              {r.finished_at && <div className="label">Ithaca {fmtTime(r.finished_at)}</div>}
            </td>
            <td className="num">{r.points}</td>
            <td className="num">{r.completed}/7</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Adjust({ crews, act }: { crews: any[]; act: (f: string, a: any) => Promise<boolean> }) {
  const [team, setTeam] = useState("");
  const [amt, setAmt] = useState("");
  const [why, setWhy] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await act("keeper_adjust", { p_team: team, p_amount: parseInt(amt, 10), p_reason: why })
        ) {
          setAmt("");
          setWhy("");
        }
      }}
    >
      <select className="field" value={team} onChange={(e) => setTeam(e.target.value)}>
        <option value="">Choose a crew</option>
        {crews.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <input
        className="field"
        type="number"
        placeholder="Amount (−50 to deduct)"
        value={amt}
        onChange={(e) => setAmt(e.target.value)}
      />
      <input
        className="field"
        placeholder="Reason"
        value={why}
        onChange={(e) => setWhy(e.target.value)}
      />
      <button className="btn w-full" disabled={!team || !amt || !why.trim()}>
        Record
      </button>
    </form>
  );
}

function Row({
  init,
  onSave,
  onDelete,
}: {
  init: any;
  onSave: (v: any) => void;
  onDelete?: () => void;
}) {
  const [v, setV] = useState(init);
  useEffect(() => setV(init), [init]);
  return (
    <div className="border-b py-3">
      {init.is_fixed && <div className="label">Fixed · Island {init.fixed_order}</div>}
      <div className="grid grid-cols-3 gap-2">
        <input
          className="field"
          value={v.theme}
          placeholder="Theme"
          onChange={(e) => setV({ ...v, theme: e.target.value })}
        />
        <input
          className="field"
          value={v.location_name}
          placeholder="Location"
          onChange={(e) => setV({ ...v, location_name: e.target.value })}
        />
        <input
          className="field"
          value={v.coords}
          placeholder="Coords"
          onChange={(e) => setV({ ...v, coords: e.target.value })}
        />
      </div>
      <div className="mt-2 flex gap-2">
        <button className="btn flex-1" onClick={() => onSave(v)}>
          Save
        </button>
        {onDelete && (
          <button className="btn" onClick={onDelete}>
            Strike
          </button>
        )}
      </div>
    </div>
  );
}

function Admin({
  pass,
  ad,
  board,
  act,
}: {
  pass: string;
  ad: any;
  board: any[];
  act: (f: string, a: any) => Promise<boolean>;
}) {
  const [newCode, setNewCode] = useState("");
  const [set, setSet] = useState<Record<string, string>>({});
  const blank = { theme: "", location_name: "", coords: "" };

  const exportCsv = () => {
    const esc = (x: unknown) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const lines = [["rank", "crew", "total points", "islands completed", "finish time"]]
      .concat(
        board.map((r) => [
          r.rank,
          r.name,
          r.points,
          r.completed,
          r.finished_at ? new Date(r.finished_at).toLocaleString() : "",
        ]),
      )
      .map((l) => l.map(esc).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    a.download = "circuit-quest-results.csv";
    a.click();
  };

  return (
    <>
      <H>Crews</H>
      <AddCrew pass={pass} onCode={setNewCode} />
      {newCode && (
        <p className="mt-2">
          New crew's code: <span className="mono text-primary">{newCode}</span>
        </p>
      )}
      <table className="ledger mt-4">
        <thead>
          <tr>
            <th>Crew</th>
            <th>Code</th>
            <th>Device</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {ad.crews.map((c: any) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td className="mono">{c.code}</td>
              <td>
                {c.device ? (
                  <button
                    className="label underline"
                    onClick={() => act("admin_release", { p_team: c.id })}
                  >
                    Release device
                  </button>
                ) : (
                  <span className="label">None</span>
                )}
              </td>
              <td className="num">
                <button
                  className="label underline"
                  onClick={() =>
                    confirm(`Remove ${c.name}?`) && act("admin_remove_crew", { p_team: c.id })
                  }
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <H>Islands</H>
      {ad.islands.map((i: any) => (
        <Row
          key={i.id}
          init={i}
          onSave={(v) =>
            act("admin_save_island", {
              p_id: i.id,
              p_theme: v.theme,
              p_loc: v.location_name,
              p_coords: v.coords,
            })
          }
        />
      ))}

      <H>Decoy locations</H>
      {ad.decoys.map((d: any) => (
        <Row
          key={d.id}
          init={d}
          onSave={(v) =>
            act("admin_save_decoy", {
              p_id: d.id,
              p_theme: v.theme,
              p_loc: v.location_name,
              p_coords: v.coords,
            })
          }
          onDelete={() => act("admin_delete_decoy", { p_id: d.id })}
        />
      ))}
      <div className="label mt-4">A new decoy</div>
      <Row
        init={blank}
        onSave={(v) =>
          act("admin_save_decoy", {
            p_id: null,
            p_theme: v.theme,
            p_loc: v.location_name,
            p_coords: v.coords,
          })
        }
      />

      <H>Words and passwords</H>
      {(
        [
          ["keeper_word", "The Keeper's word"],
          ["keeper_password", "Keeper password"],
          ["admin_password", "Admin password"],
        ] as const
      ).map(([k, l]) => (
        <div key={k} className="border-b py-3">
          <div className="label">
            {l} · now <span className="text-primary">{ad.settings[k]}</span>
          </div>
          <div className="mt-2 flex gap-2">
            <input
              className="field"
              value={set[k] ?? ""}
              onChange={(e) => setSet({ ...set, [k]: e.target.value })}
            />
            <button
              className="btn"
              onClick={async () => {
                if (await act("admin_set", { p_key: k, p_value: set[k] ?? "" }))
                  setSet({ ...set, [k]: "" });
              }}
            >
              Set
            </button>
          </div>
        </div>
      ))}
      <p className="label mt-2">
        If thou changest the Admin password, depart and return with the new one.
      </p>

      <H>Full ledger history</H>
      <table className="ledger">
        <thead>
          <tr>
            <th>When</th>
            <th>Crew</th>
            <th>Why</th>
            <th className="num">Pts</th>
          </tr>
        </thead>
        <tbody>
          {ad.history.map((h: any, i: number) => (
            <tr key={i}>
              <td className="mono text-sm">{fmtTime(h.at)}</td>
              <td>{h.crew}</td>
              <td>
                {h.reason}
                <div className="label">{h.actor}</div>
              </td>
              <td className="num">{h.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-8">
        <button className="btn btn-accent w-full" onClick={exportCsv}>
          Export results
        </button>
      </div>
    </>
  );
}

function AddCrew({ pass, onCode }: { pass: string; onCode: (c: string) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr("");
        try {
          onCode(await rpc<string>("admin_add_crew", { p_pass: pass, p_name: name }));
          setName("");
        } catch (e: any) {
          setErr(e.message);
        }
      }}
    >
      <div className="flex gap-2">
        <input
          className="field"
          placeholder="Crew name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className="btn btn-accent" disabled={!name.trim()}>
          Add
        </button>
      </div>
      {err && <p className="text-primary">{err}</p>}
    </form>
  );
}
