// The skill exam's pictures, by id: "scene.*" labelled diagrams, "task.*" joining pictures (the chosen fitting is drawn
// into the gap), "tool.*" / "part.*" icons, and "label.A"... The ids the question bank uses are listed in
// skillArtIds.json; a test checks each one can be drawn here.
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';
import { DRAWN, TOOL_GLYPHS } from './skillTools';
import { MarkerView, SCENES, TASKS } from './skillScenes';

const LABELS = ['label.A', 'label.B', 'label.C', 'label.D'] as const;
const SCENE_BOX = { x: -6, y: -6, w: 332, h: 236 };

/** True when this id has a drawing. */
export function canDrawSkillArt(id: string): boolean {
  return id in SCENES || id in TASKS || id in TOOL_GLYPHS || id in DRAWN || (LABELS as readonly string[]).includes(id);
}

interface Props {
  readonly id: string;
  /** Width in points (scenes and tasks keep their shape; icons are square). */
  readonly size?: number;
  /** A scene: the letter to highlight (the technician's choice). */
  readonly highlight?: string | null;
  /** A joining task: the part chosen, drawn into the gap. */
  readonly placed?: string | null;
  readonly testID?: string;
}

export function SkillArt({ id, size = 64, highlight, placed, testID }: Props) {
  const scene = SCENES[id];
  if (scene) {
    return (
      <Svg width={size} height={(size * SCENE_BOX.h) / SCENE_BOX.w} viewBox={`${SCENE_BOX.x} ${SCENE_BOX.y} ${SCENE_BOX.w} ${SCENE_BOX.h}`} testID={testID}>
        {scene.draw}
        {scene.markers.map((mk) => <MarkerView key={mk.letter} marker={mk} highlight={highlight === mk.letter} />)}
      </Svg>
    );
  }
  const task = TASKS[id];
  if (task) {
    const [gx, gy] = task.gap;
    const part = placed ? DRAWN[placed] : null;
    return (
      <Svg width={size} height={(size * 220) / 320} viewBox="0 0 320 220" testID={testID}>
        {task.draw}
        {part ? (
          <Svg x={gx - 44} y={gy - 44} width={88} height={88} viewBox="0 0 48 48">{part}</Svg>
        ) : (
          <G>
            <Circle cx={gx} cy={gy} r={34} fill="#FFFFFF" stroke="#0A3CF5" strokeWidth={3} strokeDasharray="8 6" />
            <SvgText x={gx} y={gy + 12} fontSize={34} fontWeight="bold" fill="#0A3CF5" textAnchor="middle">?</SvgText>
          </G>
        )}
      </Svg>
    );
  }
  if ((LABELS as readonly string[]).includes(id)) {
    const letter = id.slice(-1);
    return (
      <View style={[styles.label, { width: size, height: size, borderRadius: size / 2 }]} testID={testID}>
        <Svg width={size} height={size} viewBox="0 0 40 40">
          <SvgText x={20} y={27} fontSize={20} fontWeight="bold" fill="#FFFFFF" textAnchor="middle">{letter}</SvgText>
        </Svg>
      </View>
    );
  }
  const glyph = TOOL_GLYPHS[id];
  const drawn = DRAWN[id];
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.24, backgroundColor: glyph ? `${glyph.color}1F` : '#EEF1F8' }]} testID={testID}>
      {glyph ? (
        <MaterialCommunityIcons name={glyph.glyph} size={size * 0.62} color={glyph.color} />
      ) : drawn ? (
        <Svg width={size * 0.8} height={size * 0.8} viewBox="0 0 48 48">{drawn}</Svg>
      ) : (
        <MaterialCommunityIcons name="toolbox-outline" size={size * 0.56} color="#7C869E" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { backgroundColor: '#0A3CF5', alignItems: 'center', justifyContent: 'center' },
  tile: { alignItems: 'center', justifyContent: 'center' },
});
