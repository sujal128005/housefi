// Every picture the skill exam's question bank names (backend/src/modules/skills/questions; the list is shared in
// skillArtIds.json and checked by the backend's own test) has a drawing in the app.
import ids from '../illustrations/skillArtIds.json';
import { canDrawSkillArt } from '../illustrations/SkillArt';
import { SCENES } from '../illustrations/skillScenes';

describe('skill exam pictures', () => {
  it('draws every picture the questions use', () => {
    expect((ids as string[]).filter((id) => !canDrawSkillArt(id))).toEqual([]);
  });

  it('marks exactly the parts A, B, C and D on every diagram, inside the picture', () => {
    for (const [id, scene] of Object.entries(SCENES)) {
      expect([id, scene.markers.map((x) => x.letter)]).toEqual([id, ['A', 'B', 'C', 'D']]);
      for (const mk of scene.markers) {
        const [bx, by] = mk.bubble;
        expect([id, mk.letter, bx >= 8 && bx <= 312 && by >= 6 && by <= 216]).toEqual([id, mk.letter, true]);
      }
    }
  });
});
