// Courses: every course of the catalogue (written in the code, English and Telugu) with its lessons. HQ uploads a video
// for each lesson (MP4 or MOV, at most 100 MB: about 10 minutes at 720p), then publishes the course; technicians see
// only published courses. Removing a video unpublishes the course. Numbers: started, completed, bought.
import { useState } from 'react';
import { type AdminCourse, api, rupees, TRADE_LABEL, uploadLessonVideo, when } from './api.ts';
import { Drawer, Empty, PageHead, Pill, Segmented, TableSkeleton, useActions, useLoad } from './ui.tsx';

const LEVEL: Readonly<Record<string, string>> = { BASIC: 'Basic (free)', SAFETY: 'Safety (free)', ADVANCED: 'Advanced (₹99, free at 3.8★)' };
const MAX_BYTES = 100 * 1024 * 1024;
const minutes = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function CoursesPage() {
  const [filter, setFilter] = useState<'ALL' | 'LIVE' | 'DRAFT'>('ALL');
  const [open, setOpen] = useState<string | null>(null);
  const list = useLoad(() => api.courses(), []);
  const rows = (list.data ?? []).filter((c) => filter === 'ALL' || (filter === 'LIVE') === c.published);
  const course = list.data?.find((c) => c.id === open) ?? null;
  return (
    <div className="page">
      <PageHead title="Courses" sub="Upload a video for every lesson, then publish. Technicians see published courses in the app's Learn tab." />
      <div className="toolbar">
        <Segmented value={filter} onChange={setFilter} options={[['ALL', 'All'], ['LIVE', 'Published'], ['DRAFT', 'Not published']]} />
      </div>
      <div className="card flush">
        {!list.data ? <TableSkeleton rows={6} /> : rows.length === 0 ? <Empty title="None here" /> : (
          <table className="table">
            <thead><tr><th>Course</th><th>Trade</th><th>Level</th><th>Videos</th><th>State</th><th>Started</th><th>Completed</th><th>Bought</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const have = c.lessons.filter((l) => l.video).length;
                return (
                  <tr key={c.id} onClick={() => setOpen(c.id)} className={open === c.id ? 'selected' : ''}>
                    <td className="strong">{c.title.en}<div className="muted small">{c.title.te}</div></td>
                    <td>{c.categoryId ? TRADE_LABEL[c.categoryId] ?? c.categoryId : 'All trades'}</td>
                    <td>{LEVEL[c.level]}</td>
                    <td>{have}/{c.lessons.length}</td>
                    <td>{c.published ? <Pill tone="done">published</Pill> : have === c.lessons.length ? <Pill tone="wait">ready to publish</Pill> : <Pill tone="plain">needs videos</Pill>}</td>
                    <td>{c.stats.enrolled}</td>
                    <td>{c.stats.completed}</td>
                    <td>{c.stats.paid ? `${c.stats.paid} · ${rupees(c.stats.revenue)}` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {course ? <CoursePanel c={course} onClose={() => setOpen(null)} onChanged={list.reload} /> : null}
    </div>
  );
}

function CoursePanel({ c, onClose, onChanged }: { readonly c: AdminCourse; readonly onClose: () => void; readonly onChanged: () => void }) {
  const { confirm, toast } = useActions();
  const [busy, setBusy] = useState<string | null>(null);
  const [share, setShare] = useState(0);
  const complete = c.lessons.every((l) => l.video);

  const upload = async (lessonId: string, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return toast('This file is larger than 100 MB. Export it at 720p (about 10 minutes fits), then try again.', 'error');
    setBusy(lessonId);
    setShare(0);
    try {
      await uploadLessonVideo(c.id, lessonId, file, setShare);
      toast('Video uploaded');
      onChanged();
    } catch (e) {
      toast(`Not uploaded: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Drawer title={c.title.en} sub={<>{c.title.te} · {LEVEL[c.level]} · {c.quizQuestions}-question quiz</>} onClose={onClose} wide>
      <div className="actions-row">
        {c.published
          ? <button className="btn danger-outline" onClick={() => confirm({ title: 'Unpublish this course?', body: 'Technicians stop seeing it. Their progress is kept.', confirm: 'Unpublish', danger: true, run: async () => { await api.publishCourse(c.id, false); onChanged(); }, done: 'Unpublished' })}>Unpublish</button>
          : <button className="btn primary" disabled={!complete} title={complete ? '' : 'Every lesson needs its video first'} onClick={() => confirm({ title: 'Publish this course?', body: 'Technicians see it in the Learn tab at once.', confirm: 'Publish', run: async () => { await api.publishCourse(c.id, true); onChanged(); }, done: 'Published' })}>Publish</button>}
        <span className="muted small">{c.stats.enrolled} started · {c.stats.completed} completed{c.stats.paid ? ` · ${c.stats.paid} bought (${rupees(c.stats.revenue)})` : ''}</span>
      </div>
      <p className="muted small">MP4 or MOV, at most 100 MB per lesson (export at 720p: about 10 minutes fits). Show the work clearly and speak simply; Telugu is welcome.</p>
      {c.lessons.map((l, i) => (
        <div key={l.id} className="card inner">
          <div className="row-between">
            <span className="strong">{i + 1}. {l.title.en} <span className="muted small">· {l.title.te}</span></span>
            {l.video ? <Pill tone="done">{minutes(l.video.durationSec)} · {(l.video.bytes / 1048576).toFixed(0)} MB · {when(l.video.uploadedAt)}</Pill> : <Pill tone="plain">no video</Pill>}
          </div>
          {l.video ? <video className="skill-video" src={l.video.url} controls preload="metadata" /> : null}
          {busy === l.id ? (
            <div className="upload-bar"><div style={{ width: `${Math.round(share * 100)}%` }} /><span>{share < 1 ? `Uploading ${Math.round(share * 100)}%` : 'Checking the video…'}</span></div>
          ) : (
            <div className="actions-row">
              <label className="btn small">
                {l.video ? 'Replace video' : 'Upload video'}
                <input type="file" accept="video/mp4,video/quicktime" hidden disabled={busy !== null} onChange={(e) => void upload(l.id, e.target.files?.[0])} />
              </label>
              {l.video ? <button className="btn small danger-outline" onClick={() => confirm({ title: 'Remove this video?', body: c.published ? 'The course is unpublished until the lesson has a video again.' : 'The lesson needs a video before the course can be published.', confirm: 'Remove', danger: true, run: async () => { await api.removeLessonVideo(c.id, l.id); onChanged(); }, done: 'Removed' })}>Remove</button> : null}
            </div>
          )}
        </div>
      ))}
    </Drawer>
  );
}
