import { FormEvent, useEffect, useMemo, useState } from 'react';

import { supabase } from './supabase';

type TabRole = 'crew' | 'keeper' | 'admin';

type CrewSession = { teamId: number; teamName: string; token: string };
type OperatorSession = { role: 'keeper' | 'admin'; token: string };

type CrewState = {
  team_name: string;
  score: number;
  status: 'travelling' | 'awaiting' | 'astray';
  current_step: number;
  total_steps: number;
  theme: string | null;
  location_name: string | null;
  coords: string | null;
  finished_at: string | null;
  winner: boolean;
  wait_seconds: number;
};

type AwaitingRow = { team_id: number; team_name: string; theme: string; location_name: string; coords: string };
type LedgerRow = {
  rank: number;
  team_id: number;
  team_name: string;
  total_points: number;
  islands_completed: number;
  finished_at: string | null;
  winner: boolean;
};
type CrewRow = {
  id: number;
  name: string;
  login_code: string;
  current_step: number;
  status: string;
  finished_at: string | null;
  session_active: boolean;
};
type IslandRow = { id: number; theme: string; location_name: string; coords: string; is_fixed: boolean; fixed_order: number | null };
type DecoyRow = { id: number; theme: string; location_name: string; coords: string };
type HistoryRow = { id: number; team_name: string; amount: number; reason: string; actor: string; created_at: string };

type Snapshot = {
  role: 'keeper' | 'admin';
  awaiting: AwaitingRow[];
  astray: AwaitingRow[];
  ledger: LedgerRow[];
  crews: CrewRow[];
  islands: IslandRow[];
  decoys: DecoyRow[];
  keeper_word: string | null;
  ledger_history: HistoryRow[];
};

const CREW_KEY = 'odeceee-crew-session';
const OP_KEY = 'odeceee-operator-session';

async function callRpc<T>(fn: string, payload: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, payload);
  if (error) throw new Error(error.message);
  return data as T;
}

function fmtTime(raw: string | null): string {
  if (!raw) return '—';
  return new Date(raw).toLocaleTimeString();
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return 'rank,crew,total_points,islands_completed,finish_time\n';
  const keys = Object.keys(rows[0]);
  const esc = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [keys.join(','), ...rows.map((row) => keys.map((k) => esc(row[k])).join(','))].join('\n');
}

export default function App() {
  const [tab, setTab] = useState<TabRole>('crew');

  const [crewCode, setCrewCode] = useState('');
  const [crewWord, setCrewWord] = useState('');
  const [crewNote, setCrewNote] = useState('');
  const [crewSession, setCrewSession] = useState<CrewSession | null>(() => {
    const raw = localStorage.getItem(CREW_KEY);
    return raw ? (JSON.parse(raw) as CrewSession) : null;
  });
  const [crewState, setCrewState] = useState<CrewState | null>(null);

  const [password, setPassword] = useState({ keeper: '', admin: '' });
  const [opNote, setOpNote] = useState('');
  const [operator, setOperator] = useState<OperatorSession | null>(() => {
    const raw = localStorage.getItem(OP_KEY);
    return raw ? (JSON.parse(raw) as OperatorSession) : null;
  });
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [pointsDraft, setPointsDraft] = useState<Record<number, number>>({});
  const [islandsDraft, setIslandsDraft] = useState<IslandRow[]>([]);
  const [decoysDraft, setDecoysDraft] = useState<DecoyRow[]>([]);
  const [newCrew, setNewCrew] = useState('');
  const [adjust, setAdjust] = useState({ teamId: '', amount: '0', reason: '' });
  const [settingsDraft, setSettingsDraft] = useState({ keeperWord: '', keeperPassword: '', adminPassword: '' });

  useEffect(() => {
    if (crewSession) localStorage.setItem(CREW_KEY, JSON.stringify(crewSession));
    else localStorage.removeItem(CREW_KEY);
  }, [crewSession]);

  useEffect(() => {
    if (operator) localStorage.setItem(OP_KEY, JSON.stringify(operator));
    else localStorage.removeItem(OP_KEY);
  }, [operator]);

  const refreshCrew = async () => {
    if (!crewSession) return;
    try {
      const next = await callRpc<CrewState>('app_crew_state', {
        p_team_id: crewSession.teamId,
        p_token: crewSession.token,
      });
      setCrewState(next);
      setCrewNote('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Crew state unavailable.';
      setCrewNote(message);
      if (message.includes('another device')) setCrewSession(null);
    }
  };

  const refreshSnapshot = async () => {
    if (!operator) return;
    try {
      const next = await callRpc<Snapshot>('app_snapshot', { p_token: operator.token });
      setSnapshot(next);
      setIslandsDraft(next.islands);
      setDecoysDraft(next.decoys);
      setSettingsDraft((prev) => ({ ...prev, keeperWord: next.keeper_word ?? '' }));
      setOpNote('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Data unavailable.';
      setOpNote(message);
      if (message.includes('expired')) setOperator(null);
    }
  };

  useEffect(() => {
    refreshCrew();
  }, [crewSession?.teamId]);

  useEffect(() => {
    if (!crewSession) return;
    const timer = window.setInterval(refreshCrew, 3500);
    const channel = supabase
      .channel(`crew-${crewSession.teamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, refreshCrew)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger' }, refreshCrew)
      .subscribe();

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [crewSession?.teamId, crewSession?.token]);

  useEffect(() => {
    refreshSnapshot();
  }, [operator?.token]);

  useEffect(() => {
    if (!operator) return;
    const timer = window.setInterval(refreshSnapshot, 3500);
    const channel = supabase
      .channel(`operator-${operator.role}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, refreshSnapshot)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger' }, refreshSnapshot)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'islands' }, refreshSnapshot)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'decoy_locations' }, refreshSnapshot)
      .subscribe();

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [operator?.token]);

  const awaitingById = useMemo(
    () => Object.fromEntries((snapshot?.awaiting ?? []).map((row) => [row.team_id, pointsDraft[row.team_id] ?? 100])),
    [snapshot?.awaiting, pointsDraft],
  );

  const crewLogin = async (event: FormEvent) => {
    event.preventDefault();
    setCrewNote('');
    try {
      const data = await callRpc<{ team_id: number; team_name: string; token: string }>('app_login_crew', {
        p_login_code: crewCode,
      });
      setCrewSession({ teamId: data.team_id, teamName: data.team_name, token: data.token });
      setCrewCode('');
    } catch (error) {
      setCrewNote(error instanceof Error ? error.message : 'That crew code is not known.');
    }
  };

  const submitWord = async (event: FormEvent) => {
    event.preventDefault();
    if (!crewSession) return;
    try {
      const res = await callRpc<{ ok: boolean; message: string }>('app_submit_keeper_word', {
        p_team_id: crewSession.teamId,
        p_token: crewSession.token,
        p_word: crewWord,
      });
      setCrewNote(res.message);
      setCrewWord('');
      await refreshCrew();
    } catch (error) {
      setCrewNote(error instanceof Error ? error.message : 'That word is not known.');
    }
  };

  const operatorLogin = async (role: 'keeper' | 'admin') => {
    setOpNote('');
    try {
      const data = await callRpc<{ role: 'keeper' | 'admin'; token: string }>('app_login_role', {
        p_role: role,
        p_password: password[role],
      });
      setOperator(data);
      setPassword((prev) => ({ ...prev, [role]: '' }));
    } catch (error) {
      setOpNote(error instanceof Error ? error.message : 'That password is not known.');
    }
  };

  const grant = async (teamId: number) => {
    if (!operator) return;
    const points = awaitingById[teamId] ?? 100;
    await callRpc('app_grant', { p_token: operator.token, p_team_id: teamId, p_points: Number(points) });
    await refreshSnapshot();
  };

  const sendAstray = async (teamId: number) => {
    if (!operator) return;
    await callRpc('app_send_astray', { p_token: operator.token, p_team_id: teamId });
    await refreshSnapshot();
  };

  const returnToSiren = async (teamId: number) => {
    if (!operator) return;
    await callRpc('app_return_to_siren', { p_token: operator.token, p_team_id: teamId });
    await refreshSnapshot();
  };

  const adjustPoints = async (event: FormEvent) => {
    event.preventDefault();
    if (!operator || !adjust.teamId) return;
    await callRpc('app_adjust_points', {
      p_token: operator.token,
      p_team_id: Number(adjust.teamId),
      p_amount: Number(adjust.amount),
      p_reason: adjust.reason,
    });
    setAdjust({ teamId: '', amount: '0', reason: '' });
    await refreshSnapshot();
  };

  const addCrew = async (event: FormEvent) => {
    event.preventDefault();
    if (!operator) return;
    try {
      await callRpc('app_admin_add_crew_secure', { p_token: operator.token, p_name: newCrew.trim() });
      setNewCrew('');
      setOpNote('');
      await refreshSnapshot();
    } catch (error) {
      setOpNote(error instanceof Error ? error.message : 'Could not add crew.');
    }
  };

  const removeCrew = async (teamId: number) => {
    if (!operator) return;
    await callRpc('app_admin_remove_crew', { p_token: operator.token, p_team_id: teamId });
    await refreshSnapshot();
  };

  const releaseCrew = async (teamId: number) => {
    if (!operator) return;
    await callRpc('app_admin_release_device', { p_token: operator.token, p_team_id: teamId });
    await refreshSnapshot();
  };

  const saveIsland = async (island: IslandRow) => {
    if (!operator) return;
    await callRpc('app_admin_save_island', {
      p_token: operator.token,
      p_id: island.id,
      p_theme: island.theme,
      p_location_name: island.location_name,
      p_coords: island.coords,
      p_is_fixed: island.is_fixed,
      p_fixed_order: island.fixed_order,
    });
    await refreshSnapshot();
  };

  const saveDecoy = async (decoy: DecoyRow) => {
    if (!operator) return;
    await callRpc('app_admin_save_decoy', {
      p_token: operator.token,
      p_id: decoy.id,
      p_theme: decoy.theme,
      p_location_name: decoy.location_name,
      p_coords: decoy.coords,
    });
    await refreshSnapshot();
  };

  const saveSettings = async (event: FormEvent) => {
    event.preventDefault();
    if (!operator) return;
    await callRpc('app_admin_save_settings', {
      p_token: operator.token,
      p_keeper_word: settingsDraft.keeperWord,
      p_keeper_password: settingsDraft.keeperPassword,
      p_admin_password: settingsDraft.adminPassword,
    });
    setSettingsDraft((prev) => ({ ...prev, keeperPassword: '', adminPassword: '' }));
    await refreshSnapshot();
  };

  const exportResults = async () => {
    if (!operator) return;
    const rows = await callRpc<Record<string, unknown>[]>('app_export_results', { p_token: operator.token });
    const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'odeceee-results.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page">
      <div className="meander" aria-hidden="true" />
      <header className="masthead">
        <h1>ODECEEE: THE CIRCUIT QUEST</h1>
        <p>The Odyssey in seven islands</p>
      </header>

      <nav className="tabs">
        {(['crew', 'keeper', 'admin'] as TabRole[]).map((name) => (
          <button key={name} type="button" className={tab === name ? 'active' : ''} onClick={() => setTab(name)}>
            {name === 'crew' ? 'Crew' : name === 'keeper' ? 'Keeper' : 'Admin'}
          </button>
        ))}
      </nav>

      {tab === 'crew' && (
        <section className="panel">
          <label className="small">Crew code</label>
          {!crewSession ? (
            <form onSubmit={crewLogin} className="stack">
              <input value={crewCode} onChange={(e) => setCrewCode(e.target.value)} required />
              <button type="submit">Enter</button>
            </form>
          ) : (
            <div className="stack">
              <div className="line"><span className="small">Crew</span><strong>{crewState?.team_name ?? crewSession.teamName}</strong></div>
              <div className="line"><span className="small">Score</span><strong>{crewState?.score ?? 0}</strong></div>

              {crewState?.finished_at ? (
                <div className="notice">
                  <h2>Ithaca reached</h2>
                  <p>Final score: {crewState.score}</p>
                  <p>Finish: {fmtTime(crewState.finished_at)} {crewState.winner ? '(WINNER)' : ''}</p>
                </div>
              ) : crewState?.status === 'awaiting' ? (
                <div className="notice">
                  <h2>Awaiting the Keeper&apos;s judgment</h2>
                </div>
              ) : (
                <>
                  <div className="line"><span className="small">Island</span><strong>{crewState?.current_step ?? 1} of 7</strong></div>
                  <h2>{crewState?.theme}</h2>
                  <p>Coordinates: {crewState?.coords}</p>
                  <form onSubmit={submitWord} className="stack">
                    <label className="small">Enter the Keeper&apos;s word</label>
                    <input value={crewWord} onChange={(e) => setCrewWord(e.target.value)} required />
                    <button type="submit">Submit word</button>
                  </form>
                  {crewState && crewState.wait_seconds > 0 && (
                    <p className="small">Thy crew is lost: wait {crewState.wait_seconds} seconds</p>
                  )}
                </>
              )}

              <button type="button" onClick={() => setCrewSession(null)}>Log out</button>
            </div>
          )}
          {crewNote && <p className="note">{crewNote}</p>}
        </section>
      )}

      {(tab === 'keeper' || tab === 'admin') && (
        <section className="panel">
          {!operator || operator.role !== tab ? (
            <div className="stack">
              <label className="small">{tab === 'keeper' ? 'Keeper password' : 'Admin password'}</label>
              <input
                type="password"
                value={password[tab]}
                onChange={(e) => setPassword((prev) => ({ ...prev, [tab]: e.target.value }))}
              />
              <button type="button" onClick={() => operatorLogin(tab)}>
                Enter
              </button>
            </div>
          ) : (
            <div className="stack">
              <div className="line"><span className="small">Role</span><strong>{operator.role}</strong></div>
              <button type="button" onClick={() => setOperator(null)}>Log out</button>

              <h2>Awaiting judgment</h2>
              <table>
                <thead>
                  <tr><th>Crew</th><th>Island</th><th className="num">Points</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {(snapshot?.awaiting ?? []).map((row) => (
                    <tr key={row.team_id}>
                      <td>{row.team_name}</td>
                      <td>{row.theme} · {row.coords}</td>
                      <td className="num">
                        <input
                          type="number"
                          value={awaitingById[row.team_id]}
                          onChange={(e) => setPointsDraft((prev) => ({ ...prev, [row.team_id]: Number(e.target.value) }))}
                        />
                      </td>
                      <td>
                        <button type="button" onClick={() => grant(row.team_id)}>Grant</button>
                        {row.theme.toLowerCase() === 'siren' && (
                          <button type="button" onClick={() => sendAstray(row.team_id)}>Send astray</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2>Astray crews</h2>
              <table>
                <thead>
                  <tr><th>Crew</th><th>Decoy</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {(snapshot?.astray ?? []).map((row) => (
                    <tr key={row.team_id}>
                      <td>{row.team_name}</td>
                      <td>{row.theme} · {row.coords}</td>
                      <td><button type="button" onClick={() => returnToSiren(row.team_id)}>Return to Siren</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2>The Ledger</h2>
              <table>
                <thead>
                  <tr><th className="num">Rank</th><th>Crew</th><th className="num">Points</th><th className="num">Islands</th><th>Finish</th></tr>
                </thead>
                <tbody>
                  {(snapshot?.ledger ?? []).map((row) => (
                    <tr key={row.team_id}>
                      <td className="num">{row.rank}</td>
                      <td>{row.team_name} {row.winner ? 'WINNER' : ''}</td>
                      <td className="num">{row.total_points}</td>
                      <td className="num">{row.islands_completed}</td>
                      <td>{fmtTime(row.finished_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2>Manual points</h2>
              <form className="stack" onSubmit={adjustPoints}>
                <label className="small">Crew</label>
                <select value={adjust.teamId} onChange={(e) => setAdjust((prev) => ({ ...prev, teamId: e.target.value }))} required>
                  <option value="">Choose crew</option>
                  {(snapshot?.ledger ?? []).map((row) => (
                    <option key={row.team_id} value={row.team_id}>{row.team_name}</option>
                  ))}
                </select>
                <label className="small">Amount</label>
                <input type="number" value={adjust.amount} onChange={(e) => setAdjust((prev) => ({ ...prev, amount: e.target.value }))} required />
                <label className="small">Reason</label>
                <input value={adjust.reason} onChange={(e) => setAdjust((prev) => ({ ...prev, reason: e.target.value }))} required />
                <button type="submit">Record</button>
              </form>

              {operator.role === 'admin' && (
                <>
                  <h2>Add crew</h2>
                  <form className="stack" onSubmit={addCrew}>
                    <label className="small">Crew name</label>
                    <input value={newCrew} onChange={(e) => setNewCrew(e.target.value)} required />
                    <button type="submit">Add crew</button>
                  </form>

                  <h2>Crews</h2>
                  <table>
                    <thead>
                      <tr><th>Crew</th><th>Code</th><th>Status</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                      {(snapshot?.crews ?? []).map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.login_code}</td>
                          <td>{row.status} {row.session_active ? '(active)' : ''}</td>
                          <td>
                            <button type="button" onClick={() => releaseCrew(row.id)}>Release device</button>
                            <button type="button" onClick={() => removeCrew(row.id)}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <h2>Islands</h2>
                  <table>
                    <thead>
                      <tr><th>Theme</th><th>Location</th><th>Coords</th><th>Fixed</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                      {islandsDraft.map((row) => (
                        <tr key={row.id}>
                          <td><input value={row.theme} onChange={(e) => setIslandsDraft((prev) => prev.map((it) => it.id === row.id ? { ...it, theme: e.target.value } : it))} /></td>
                          <td><input value={row.location_name} onChange={(e) => setIslandsDraft((prev) => prev.map((it) => it.id === row.id ? { ...it, location_name: e.target.value } : it))} /></td>
                          <td><input value={row.coords} onChange={(e) => setIslandsDraft((prev) => prev.map((it) => it.id === row.id ? { ...it, coords: e.target.value } : it))} /></td>
                          <td>{row.is_fixed ? `Yes (${row.fixed_order})` : 'No'}</td>
                          <td><button type="button" onClick={() => saveIsland(row)}>Save</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <h2>Decoy locations</h2>
                  <table>
                    <thead>
                      <tr><th>Theme</th><th>Location</th><th>Coords</th><th>Action</th></tr>
                    </thead>
                    <tbody>
                      {decoysDraft.map((row) => (
                        <tr key={row.id}>
                          <td><input value={row.theme} onChange={(e) => setDecoysDraft((prev) => prev.map((it) => it.id === row.id ? { ...it, theme: e.target.value } : it))} /></td>
                          <td><input value={row.location_name} onChange={(e) => setDecoysDraft((prev) => prev.map((it) => it.id === row.id ? { ...it, location_name: e.target.value } : it))} /></td>
                          <td><input value={row.coords} onChange={(e) => setDecoysDraft((prev) => prev.map((it) => it.id === row.id ? { ...it, coords: e.target.value } : it))} /></td>
                          <td><button type="button" onClick={() => saveDecoy(row)}>Save</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <h2>Settings</h2>
                  <form className="stack" onSubmit={saveSettings}>
                    <label className="small">Keeper&apos;s word</label>
                    <input value={settingsDraft.keeperWord} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, keeperWord: e.target.value }))} required />
                    <label className="small">Keeper password (leave blank to keep)</label>
                    <input type="password" value={settingsDraft.keeperPassword} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, keeperPassword: e.target.value }))} />
                    <label className="small">Admin password (leave blank to keep)</label>
                    <input type="password" value={settingsDraft.adminPassword} onChange={(e) => setSettingsDraft((prev) => ({ ...prev, adminPassword: e.target.value }))} />
                    <button type="submit">Save settings</button>
                  </form>

                  <h2>Full ledger history</h2>
                  <table>
                    <thead>
                      <tr><th>When</th><th>Crew</th><th className="num">Amount</th><th>Reason</th><th>Actor</th></tr>
                    </thead>
                    <tbody>
                      {(snapshot?.ledger_history ?? []).map((row) => (
                        <tr key={row.id}>
                          <td>{new Date(row.created_at).toLocaleString()}</td>
                          <td>{row.team_name}</td>
                          <td className="num">{row.amount}</td>
                          <td>{row.reason}</td>
                          <td>{row.actor}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <button type="button" onClick={exportResults}>Export results</button>
                </>
              )}
            </div>
          )}
          {opNote && <p className="note">{opNote}</p>}
        </section>
      )}
    </main>
  );
}
