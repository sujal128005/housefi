import { createPressGuard } from '../ui/pressGuard';

describe('press guard', () => {
  it('runs the first press and ignores repeats within the window', () => {
    let t = 1000;
    const guard = createPressGuard(800, () => t);
    let runs = 0;
    const act = () => { runs += 1; };
    guard(act);
    t += 50; guard(act);
    t += 300; guard(act);
    expect(runs).toBe(1);
    t += 800; guard(act);
    expect(runs).toBe(2);
  });
});
