# K-Tour Guide v6

Ứng dụng PWA học cụm từ tiếng Hàn thực chiến cho hướng dẫn viên du lịch tại Đà Nẵng – Hội An – Bà Nà – Chùa Linh Ứng.

## Tính năng chính

- Mỗi chủ đề có **50 cụm từ** (13 chủ đề = 650 cụm từ học).
- Flashcard 2 mặt (Hàn ↔ Việt) + phiên âm + ghi chú.
- Tìm kiếm nhanh, lọc chủ đề, học ngẫu nhiên.
- Đánh dấu yêu thích, cụm từ khó, trạng thái đã nhớ + tiến độ học.
- Phát âm Web Speech API (bình thường/chậm).
- **Ghi âm giọng nói cá nhân theo từng cụm từ** (MediaRecorder + IndexedDB).
- Hỗ trợ PWA qua `manifest.json` và `service-worker.js`.

## Cấu trúc đề xuất cho audio thật (nếu muốn thay TTS)

```text
/audio/
  <topic-id>/
    <phrase-id>.mp3
```

Ví dụ: `/audio/chao-hoi/chao-hoi-1.mp3`

## Deploy GitHub Pages

1. Push toàn bộ file lên GitHub.
2. Vào **Settings → Pages**, chọn branch cần publish.
3. Mở URL Pages trên Chrome mobile (HTTPS để dùng ghi âm micro).
4. Chọn **Add to Home Screen** để cài như app.
