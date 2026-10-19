// HQ Arcade: Pipe Panic. Rotate the pipes (click: clockwise, right-click: back) to bring water from the main to the
// customer's tap before the pressure runs out. Every level is bigger and faster. A neon blueprint world of its own,
// with the founders' leaderboard.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type LeaderRow } from './api.ts';
import { type Board, E, flow, levelScore, levelSpec, makeBoard, N, rotate, S, seeded, W } from './arcade-logic.ts';

const GAME = 'pipe-panic';
type Phase = 'title' | 'playing' | 'cleared' | 'over';

/** Short synthesized blips (no sound files). Quiet, and only after the player clicked. */
function useBlips() {
  const ctx = useRef<AudioContext | null>(null);
  return useCallback((kind: 'turn' | 'win' | 'lose') => {
    try {
      ctx.current ??= new AudioContext();
      const a = ctx.current;
      const o = a.createOscillator();
      const g = a.createGain();
      const t = a.currentTime;
      const notes = kind === 'turn' ? [660] : kind === 'win' ? [523, 659, 784, 1047] : [392, 330, 262];
      o.type = kind === 'turn' ? 'triangle' : 'sine';
      notes.forEach((f, i) => o.frequency.setValueAtTime(f, t + i * 0.09));
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'turn' ? 0.04 : 0.08, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 * notes.length + 0.12);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.09 * notes.length + 0.15);
    } catch {
      // No sound: the game works without it.
    }
  }, []);
}

export function ArcadePage({ me }: { readonly me: string }) {
  const [phase, setPhase] = useState<Phase>('title');
  const [level, setLevel] = useState(1);
  const [board, setBoard] = useState<Board | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [score, setScore] = useState(0);
  const [turns, setTurns] = useState(0);
  const [spin, setSpin] = useState<Record<number, number>>({});
  const [leaders, setLeaders] = useState<LeaderRow[]>([]);
  const [result, setResult] = useState<{ best: number; rank: number } | null>(null);
  const blip = useBlips();
  const seedRef = useRef(Date.now());

  const loadLeaders = useCallback(() => {
    api.leaderboard(GAME).then(setLeaders, () => undefined);
  }, []);
  useEffect(loadLeaders, [loadLeaders]);

  const start = (lvl: number, total: number) => {
    const spec = levelSpec(lvl);
    let b = makeBoard(spec.rows, spec.cols, seeded(seedRef.current + lvl * 7919));
    // Never start already solved.
    while (flow(b).solved) b = { ...b, tiles: b.tiles.map((t) => rotate(t)) };
    setBoard(b);
    setSpin({});
    setTurns(0);
    setLevel(lvl);
    setScore(total);
    setTimeLeft(spec.seconds);
    setPhase('playing');
  };

  // The pressure clock.
  useEffect(() => {
    if (phase !== 'playing') return;
    const id = setInterval(() => setTimeLeft((t) => Math.max(0, t - 0.1)), 100);
    return () => clearInterval(id);
  }, [phase]);

  const finish = useCallback(async (finalScore: number, lvl: number) => {
    setPhase('over');
    blip('lose');
    try {
      setResult(await api.saveScore(GAME, finalScore, `level ${lvl}`));
    } catch (e) {
      if (!(e instanceof ApiError)) setResult(null);
    }
    loadLeaders();
  }, [blip, loadLeaders]);

  useEffect(() => {
    if (phase === 'playing' && timeLeft <= 0) void finish(score, level);
  }, [phase, timeLeft, score, level, finish]);

  const state = board ? flow(board) : null;

  const turn = (i: number, back: boolean) => {
    if (phase !== 'playing' || !board) return;
    const tiles = board.tiles.slice();
    tiles[i] = rotate(tiles[i]!, back ? 3 : 1);
    const next = { ...board, tiles };
    setBoard(next);
    setSpin((s) => ({ ...s, [i]: (s[i] ?? 0) + (back ? -90 : 90) }));
    setTurns((n) => n + 1);
    blip('turn');
    if (flow(next).solved) {
      const gained = levelScore(level, timeLeft, turns + 1, tiles.length);
      setScore((s) => s + gained);
      setPhase('cleared');
      blip('win');
    }
  };

  const pct = board ? timeLeft / levelSpec(level).seconds : 1;
  return (
    <div className="page arcade-page">
      <div className="arcade">
        <div className="arcade-scan" aria-hidden="true" />
        <header className="arcade-head">
          <div>
            <div className="arcade-kicker">HQ ARCADE · NO. 01</div>
            <h1 className="arcade-title">PIPE<span>PANIC</span></h1>
          </div>
          <div className="arcade-hud">
            <div><span>LEVEL</span><b>{String(level).padStart(2, '0')}</b></div>
            <div><span>SCORE</span><b>{String(score).padStart(5, '0')}</b></div>
            <div className={`arcade-pressure${pct < 0.3 ? ' low' : ''}`}><span>PRESSURE</span><i><em style={{ width: `${Math.max(0, pct * 100)}%` }} /></i></div>
          </div>
        </header>

        <div className="arcade-stage">
          {phase === 'title' ? (
            <div className="arcade-card">
              <p className="arcade-story">A customer in Banjara Hills has a dry tap. Turn the pipes so water runs from the <b className="cyan">main</b> to the <b className="amber">tap</b> before the pressure drops.</p>
              <ul className="arcade-keys"><li><kbd>Click</kbd> turn clockwise</li><li><kbd>Right-click</kbd> turn back</li><li>Fewer turns, more points</li></ul>
              <button className="arcade-btn" onClick={() => start(1, 0)}>START SHIFT ▸</button>
            </div>
          ) : board ? (
            <div className="pipe-wrap">
              <div className="pipe-main" style={{ top: `${(board.source + 0.5) * (100 / board.rows)}%` }}><span>MAIN</span></div>
              <div className="pipe-grid" style={{ gridTemplateColumns: `repeat(${board.cols}, var(--tile))`, gridTemplateRows: `repeat(${board.rows}, var(--tile))` }} onContextMenu={(e) => e.preventDefault()}>
                {board.tiles.map((m, i) => (
                  <button key={i} className={`pipe-tile${state?.wet.has(i) ? ' wet' : ''}${phase === 'cleared' && state?.wet.has(i) ? ' flow' : ''}`}
                    onClick={() => turn(i, false)} onContextMenu={(e) => { e.preventDefault(); turn(i, true); }} aria-label="Pipe tile, click to turn">
                    <PipeGlyph mask={rotate(m, -Math.round((spin[i] ?? 0) / 90))} angle={spin[i] ?? 0} />
                  </button>
                ))}
              </div>
              <div className={`pipe-tap${state?.solved ? ' on' : ''}`} style={{ top: `${(board.drain + 0.5) * (100 / board.rows)}%` }}><span>TAP</span></div>
              {phase === 'cleared' ? (
                <div className="arcade-overlay">
                  <div className="arcade-card">
                    <div className="arcade-kicker">LEVEL {level} CLEARED</div>
                    <h2 className="arcade-big">Water's running 💧</h2>
                    <p>{Math.ceil(timeLeft)} s of pressure left · {turns} turns</p>
                    <button className="arcade-btn" onClick={() => start(level + 1, score)}>NEXT JOB ▸</button>
                  </div>
                </div>
              ) : null}
              {phase === 'over' ? (
                <div className="arcade-overlay">
                  <div className="arcade-card">
                    <div className="arcade-kicker">PRESSURE LOST</div>
                    <h2 className="arcade-big">{score} points</h2>
                    <p>Reached level {level}{result ? ` · your best ${result.best} · #${result.rank} all time` : ''}</p>
                    <button className="arcade-btn" onClick={() => { seedRef.current = Date.now(); start(1, 0); }}>NEW SHIFT ▸</button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="arcade-board">
          <div className="arcade-kicker">FOUNDERS' LEADERBOARD</div>
          {leaders.length === 0 ? <p className="arcade-dim">No scores yet. Be the first, {me.split(' ')[0]}.</p> : (
            <ol>
              {leaders.map((r, i) => (
                <li key={`${r.name}-${r.at}`} className={r.name === me ? 'me' : ''}>
                  <span className="rank">{i === 0 ? '♛' : i + 1}</span>
                  <span className="who">{r.name}</span>
                  <span className="pts">{r.score}</span>
                  <span className="lvl">{r.detail}</span>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}

/** One pipe piece: the openings drawn as glowing tubes, turned with an animation. */
function PipeGlyph({ mask, angle }: { readonly mask: number; readonly angle: number }) {
  const arms: { bit: number; d: string }[] = [
    { bit: N, d: 'M32 32 L32 0' },
    { bit: E, d: 'M32 32 L64 32' },
    { bit: S, d: 'M32 32 L32 64' },
    { bit: W, d: 'M32 32 L0 32' },
  ];
  return (
    <svg viewBox="0 0 64 64" className="pipe-svg" style={{ transform: `rotate(${angle}deg)` }}>
      {arms.filter((a) => mask & a.bit).map((a) => <path key={a.bit} d={a.d} className="pipe-outer" />)}
      {arms.filter((a) => mask & a.bit).map((a) => <path key={`i${a.bit}`} d={a.d} className="pipe-inner" />)}
      <circle cx="32" cy="32" r="7" className="pipe-joint" />
    </svg>
  );
}
