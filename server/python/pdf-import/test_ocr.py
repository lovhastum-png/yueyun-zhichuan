import unittest
from unittest.mock import patch
from types import SimpleNamespace
import pymupdf as fitz
from fastapi import HTTPException
import app


class PdfRecognitionTests(unittest.TestCase):
    def pdf(self, text=None, encrypted=False):
        with fitz.open() as doc:
            page = doc.new_page()
            if text:
                page.insert_text((40, 50), text)
            options = {'encryption': fitz.PDF_ENCRYPT_AES_256, 'owner_pw': 'owner', 'user_pw': 'secret'} if encrypted else {}
            return doc.tobytes(**options)

    def test_text_pdf_does_not_initialize_ocr(self):
        data = self.pdf('This is a searchable document with enough native text to avoid OCR processing.')
        with patch.object(app, '_get_engine', side_effect=AssertionError('OCR should not run')):
            result = app._recognize_pdf(data)
        self.assertEqual(result['total'], 1)
        self.assertIn('searchable', result['pages'][0]['text'])

    def test_scan_falls_back_to_ocr_and_receives_rgb(self):
        def recognize(image):
            self.assertEqual(image.shape[2], 3)
            self.assertLessEqual(image.shape[0] * image.shape[1], 12_020_000)
            return SimpleNamespace(txts=['越剧资料'])
        with patch.object(app, '_get_engine', return_value=recognize):
            result = app._recognize_pdf(self.pdf())
        self.assertEqual(result['pages'][0]['text'], '越剧资料')

    def test_invalid_pdf_rejected_before_engine_initialization(self):
        with patch.object(app, '_get_engine', side_effect=AssertionError('OCR should not run')):
            with self.assertRaises(HTTPException) as ctx:
                app._recognize_pdf(b'not a PDF')
        self.assertEqual(ctx.exception.status_code, 400)

    def test_password_protected_pdf_has_clear_error(self):
        with self.assertRaises(HTTPException) as ctx:
            app._recognize_pdf(self.pdf(encrypted=True))
        self.assertIn('加密', ctx.exception.detail)

    def test_invalid_configuration_uses_safe_default(self):
        with patch.dict('os.environ', {'PDF_OCR_THREADS': 'invalid'}):
            self.assertEqual(app._env_int('PDF_OCR_THREADS', 2, 1, 4), 2)


if __name__ == '__main__':
    unittest.main()
