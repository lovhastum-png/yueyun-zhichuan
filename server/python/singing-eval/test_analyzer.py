"""Run: .venv/Scripts/python.exe -m unittest test_analyzer -v"""
import tempfile
import asyncio
import io
import time
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import librosa
import numpy as np
import soundfile as sf

import analyzer
import app as service
from fastapi import UploadFile


class SingingRegressionTests(unittest.TestCase):
    def test_alignment_matches_existing_algorithm(self):
        rng = np.random.default_rng(42)
        for n, m in [(30, 30), (40, 75), (75, 40), (101, 104), (100, 201)]:
            for tied in (False, True):
                with self.subTest(n=n, m=m, tied=tied):
                    ref = rng.integers(-5, 6, n).astype(float) if tied else rng.normal(size=n)
                    stu = rng.integers(-5, 6, m).astype(float) if tied else rng.normal(size=m)
                    _, expected = librosa.sequence.dtw(
                        X=ref, Y=stu, global_constraints=True, band_rad=0.25)
                    np.testing.assert_array_equal(analyzer._banded_dtw_path(ref, stu), expected)

    def test_two_minute_alignment_retains_all_frames(self):
        t = np.arange(12001) * 0.01
        ref = 200 * np.sin(t) + 20 * np.sin(2 * np.pi * 6 * t)
        path = analyzer._banded_dtw_path(ref, ref)
        np.testing.assert_array_equal(path[:, 0], np.arange(12000, -1, -1))
        np.testing.assert_array_equal(path[:, 0], path[:, 1])

    def test_pitch_error_still_detected(self):
        ref = np.full(501, 100.0)
        voiced = np.ones(501, dtype=bool)
        good = analyzer.pitch_analysis(ref, voiced, ref, voiced)
        bad = analyzer.pitch_analysis(ref, voiced, ref + 100, voiced)
        self.assertEqual(good[0], 100)
        self.assertEqual(bad[0], 0)
        self.assertTrue(bad[1])
        self.assertEqual(bad[2]['median_abs_dev_cents'], 100)

    def test_pitch_segment_spanning_invalid_frames_is_skipped(self):
        """偏差片段内混有无效帧（devs 为 NaN）时不能抛 ValueError。

        回归背景：allow_gap 会把区间内未标记的帧一并并入，若其中包含
        「学生有声但匹配到的范本帧无声」的 NaN 帧，np.mean 会得到 NaN，
        int(round(NaN)) 直接抛 ValueError（线上实测触发过 500）。
        """
        n = 400
        ref = np.full(n, 100.0)
        ref_voiced = np.ones(n, dtype=bool)
        stu = ref + 120.0          # 全程偏高 120 音分 → 必然形成偏差片段
        stu_voiced = np.ones(n, dtype=bool)
        # 范本中段 100 帧判为无声：这些帧的学生 devs 会是 NaN，
        # 而它们夹在同一个偏差片段内
        ref_voiced[150:250] = False
        score, segs, stats, devs, valid = analyzer.pitch_analysis(
            ref, ref_voiced, stu, stu_voiced)
        self.assertTrue(np.isnan(devs[150:250]).all())
        self.assertGreater(len(segs), 0)
        for s in segs:
            self.assertNotIn('nan', s['problem_desc'].lower())
            self.assertTrue(s['problem_desc'])

    def test_rhythm_tempo_difference_is_not_penalized(self):
        """整体速度差应被仿射模型吸收，只体现在 tempo_ratio，不扣板眼分。"""
        t = np.arange(10 * analyzer.SR) / analyzer.SR
        base = 0.5 * np.sin(2 * np.pi * 300 * t) * (np.sin(2 * np.pi * 2 * t) > 0)
        voiced = np.ones(int(len(base) / (analyzer.SR * analyzer.FRAME_SEC)), dtype=bool)
        score, segs, stats = analyzer.rhythm_analysis(base, base, voiced, voiced)
        self.assertEqual(score, 100)
        self.assertEqual(stats['tempo_ratio'], 1.0)

    def test_reject_long_audio_before_decode(self):
        with tempfile.TemporaryDirectory() as folder:
            file = Path(folder) / 'long.wav'
            sf.write(file, np.zeros(121 * 8000), 8000)
            with patch.object(librosa, 'load') as load:
                with self.assertRaises(analyzer.AnalysisError):
                    analyzer.load_and_preprocess(file)
                load.assert_not_called()

    def test_full_wav_analysis(self):
        with tempfile.TemporaryDirectory() as folder:
            t = np.arange(5 * analyzer.SR) / analyzer.SR
            y = 0.4 * np.sin(2 * np.pi * 220 * t)
            file = Path(folder) / 'voice.wav'
            sf.write(file, y, analyzer.SR)
            report = analyzer.analyze(file, file)
            self.assertEqual(report['pitch_score'], 100)
            self.assertEqual(report['meta']['stu_duration'], 5)
            self.assertEqual(report['meta']['version'], '1.1.0')


class ServiceRegressionTests(unittest.IsolatedAsyncioTestCase):
    async def test_analysis_keeps_event_loop_responsive(self):
        started = threading.Event()
        def slow_analysis(*args):
            started.set()
            time.sleep(0.15)
            return {'total_score': 90}

        with patch.object(analyzer, 'analyze', side_effect=slow_analysis):
            student = UploadFile(filename='student.wav', file=io.BytesIO(b'RIFF'))
            reference = UploadFile(filename='ref.wav', file=io.BytesIO(b'RIFF'))
            job = asyncio.create_task(service.analyze(student, reference))
            await asyncio.to_thread(started.wait, 2)
            try:
                self.assertFalse(job.done(), 'Analysis must not block the event loop')
                self.assertTrue(service.health()['busy'])
            finally:
                report = await job
            self.assertEqual(report['total_score'], 90)
            self.assertFalse(service.health()['busy'])


if __name__ == '__main__':
    unittest.main()
