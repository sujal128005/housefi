// useQuery with new inputs (another booking id, another verification token) must not keep showing the previous
// answer; "Try again" (reload) keeps it while reloading.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { useQuery } from '../services/ServicesProvider';

/** Like the screens: a skeleton while loading with nothing to show, the error when there is no data. */
function Probe({ id, load, seen }: { readonly id: string; readonly load: (id: string) => Promise<string>; readonly seen: string[] }) {
  const q = useQuery(() => load(id), [id]);
  const text = q.data !== undefined ? `data:${q.data}` : q.loading ? 'loading' : q.error ? 'error' : 'empty';
  seen.push(`${id}:${text}`);
  return (
    <Pressable onPress={q.reload} testID="reload">
      <Text>{text}</Text>
    </Pressable>
  );
}

const load = (id: string) => (id === 'bad' ? Promise.reject(new Error('not found')) : Promise.resolve(`tech-${id}`));

describe('useQuery', () => {
  it('drops the previous answer as soon as its inputs change', async () => {
    const seen: string[] = [];
    const view = await render(<Probe id="a" load={load} seen={seen} />);
    expect(await screen.findByText('data:tech-a')).toBeTruthy();
    await view.rerender(<Probe id="bad" load={load} seen={seen} />);
    expect(await screen.findByText('error')).toBeTruthy();
    expect(screen.queryByText('data:tech-a')).toBeNull();
    // Not even for one render: every render with the new id is without the old answer.
    expect(seen.filter((s) => s.startsWith('bad:'))).not.toContain('bad:data:tech-a');
  });

  it('shows the new answer for a new valid id', async () => {
    const seen: string[] = [];
    const view = await render(<Probe id="a" load={load} seen={seen} />);
    await screen.findByText('data:tech-a');
    await view.rerender(<Probe id="b" load={load} seen={seen} />);
    expect(await screen.findByText('data:tech-b')).toBeTruthy();
    expect(seen.filter((s) => s.startsWith('b:'))).not.toContain('b:data:tech-a');
  });

  it('keeps the answer on screen while reloading', async () => {
    const seen: string[] = [];
    let release: () => void = () => undefined;
    let calls = 0;
    const slowSecond = (id: string) => {
      calls += 1;
      if (calls === 1) return Promise.resolve(`tech-${id}`);
      return new Promise<string>((res) => {
        release = () => res(`tech-${id}-fresh`);
      });
    };
    await render(<Probe id="a" load={slowSecond} seen={seen} />);
    await screen.findByText('data:tech-a');
    await fireEvent.press(screen.getByTestId('reload'));
    expect(screen.getByText('data:tech-a')).toBeTruthy(); // still shown while the reload runs
    await act(async () => release());
    expect(await screen.findByText('data:tech-a-fresh')).toBeTruthy();
  });
});
