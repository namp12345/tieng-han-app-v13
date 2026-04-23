# V13 Baseline Audit (Safe Upgrade Plan)

## 1) Tóm tắt cấu trúc project hiện tại

Dự án hiện là một **PWA thuần front-end**, không có build tool, không có framework, không có backend.

- `index.html`: khung giao diện chính, điều hướng tab (Học/Quiz/Ôn tập/Thống kê/Cài đặt), và template flashcard + quiz.
- `styles.css`: toàn bộ style cho app (mobile-first ở mức cơ bản).
- `app.js`: logic chính của ứng dụng (state, render view, progress, quiz, settings, speech, ghi âm IndexedDB, service worker registration).
- `phrases.js`: dữ liệu chủ đề và cụm từ (13 chủ đề, mỗi chủ đề sinh 50 cụm từ qua hàm trộn).
- `service-worker.js`: cache offline theo chiến lược cache-first + network fallback.
- `manifest.json`: cấu hình cài đặt PWA.
- `README.md`: mô tả dự án, hiện vẫn ghi tên/phiên bản `K-Tour Guide v6`.

## 2) Kiểm tra lỗi tổng thể (chưa sửa lớn)

Đã kiểm tra nhanh mức nền tảng:

- Cú pháp JS: pass (`app.js`, `phrases.js`).
- JSON manifest hợp lệ: pass.
- ID chủ đề trong dữ liệu: 13 ID, không trùng.

Kết luận: app có thể chạy ở mức cơ bản, nhưng có một số rủi ro kiến trúc/chất lượng cần xử lý an toàn theo từng bước.

## 3) Rủi ro chính (ưu tiên theo mức độ)

### R1. Hàm trùng tên `ensureDaily` trong `app.js`
- File hiện có **2 định nghĩa** `ensureDaily`, định nghĩa phía sau sẽ override định nghĩa phía trước.
- Rủi ro: khó debug, dễ phát sinh lỗi thống kê khi refactor về sau.
- Mức độ: Cao.

### R2. Phụ thuộc dịch tự động runtime qua endpoint Google Translate không chính thức
- `translateWord()` gọi trực tiếp `translate.googleapis.com` từ client.
- Rủi ro: rate-limit, CORS, thay đổi API, lỗi offline, không ổn định cho trải nghiệm học hằng ngày.
- Mức độ: Cao.

### R3. `service-worker.js` cache mọi request GET theo kiểu cache-first
- Hiện cache cả request ngoài dự kiến, không giới hạn phạm vi/TTL.
- Rủi ro: phình cache, dữ liệu stale lâu, hành vi khó dự đoán.
- Mức độ: Trung bình-Cao.

### R4. Logic + dữ liệu tập trung vào 2 file lớn (`app.js`, `phrases.js`)
- Khó mở rộng, khó test, khó kiểm soát regression.
- Mức độ: Trung bình.

### R5. Nhất quán phiên bản chưa rõ “v13”
- README/title/manifest/cache key vẫn mang nhãn `v6`.
- Rủi ro: mâu thuẫn nhận diện baseline sạch của v13, dễ nhầm lịch sử phát hành.
- Mức độ: Trung bình.

## 4) Kế hoạch nâng cấp an toàn (không sửa lớn ngay)

### Phase 0 — Đóng băng baseline sạch (an toàn nhất)
1. Tag baseline hiện tại (ví dụ `baseline-v13-clean-0`).
2. Không cherry-pick từ nhánh lỗi cũ.
3. Chuẩn hóa checklist smoke test thủ công: Learn/Quiz/Settings/Offline/Add to Home Screen.

### Phase 1 — Ổn định kỹ thuật tối thiểu (small, reversible)
1. Gỡ trùng `ensureDaily` và gom logic thống kê về 1 chỗ duy nhất.
2. Đóng gói helper `storage`, `stats`, `progress` thành module riêng (chưa đổi hành vi).
3. Giới hạn cache service worker theo allow-list asset tĩnh + chiến lược fallback rõ ràng.
4. Thêm script kiểm tra nhanh (`npm` chưa cần): `node --check`, kiểm tra data shape.

### Phase 2 — Nâng chất lượng dữ liệu học
1. Tách dataset thành nhiều file theo chủ đề.
2. Thêm schema validation cho phrase/topic khi app khởi động.
3. Đánh dấu metadata học (độ khó, loại tình huống, thời điểm học khuyến nghị).

### Phase 3 — Nâng cấp UX học mỗi ngày
1. Tối ưu nhịp học ngắn (5–10 phút), tập trung “bài hôm nay”.
2. Thêm “Daily path” + nhắc ôn theo spaced repetition nhẹ.
3. Tăng khả năng ghi nhớ: nhóm phrase theo ngữ cảnh + cue hình ảnh nhất quán.

## 5) Định hướng cải tiến giao diện (sáng hơn, dễ nhìn, logic, dễ nhớ)

## Mục tiêu UX
- Sáng rõ, tương phản đủ, giảm mỏi mắt.
- Học theo dòng chảy rõ ràng: Hôm nay → Luyện → Ôn lại.
- Tăng “memory cues” (màu, icon, cấu trúc thẻ, phản hồi).

## Đề xuất UI cụ thể

### A. Thiết kế thị giác
1. Đổi bảng màu sang nền sáng trung tính, nhấn xanh dịu + màu trạng thái rõ.
2. Tăng khoảng trắng và phân cấp chữ (Korean lớn nhất, Việt nghĩa đứng ngay dưới).
3. Chuẩn hóa kích thước nút tối thiểu 44px, icon + nhãn rõ nghĩa.

### B. Kiến trúc màn hình “học mỗi ngày”
1. Home/Learn thành dạng “Hôm nay bạn học gì?” với 3 block:
   - Bài hiện tại
   - Ôn lại cần làm
   - Thành tích ngày
2. Thu gọn tab chính còn 3 mục: `Học hôm nay`, `Ôn tập`, `Tiến độ`.
3. Quiz đặt sau khi hoàn thành 1 cụm nhỏ (micro-loop), tránh tách rời.

### C. Tăng khả năng ghi nhớ
1. Mỗi thẻ có nhãn ngữ cảnh (Sân bay/Khách sạn/Khẩn cấp...).
2. Dùng pattern cố định mặt trước/mặt sau (luôn cùng vị trí cho Korean/Roman/Meaning).
3. Feedback tức thì: đúng/sai + gợi ý phát âm + nhắc ôn lại sau X giờ.

### D. Khả dụng & tiếp cận
1. Chế độ chữ to (Large text).
2. Tăng tương phản và trạng thái focus cho thao tác bàn phím.
3. Tránh phụ thuộc màu sắc đơn lẻ để biểu thị trạng thái.

## 6) Nguyên tắc để tránh lặp lại “nhánh lỗi cũ”

1. Làm việc trên một baseline sạch duy nhất của repo hiện tại.
2. Mọi thay đổi lớn đi theo nhánh tính năng mới, PR nhỏ, rollback dễ.
3. Áp dụng “guard rails”:
   - Không đổi dữ liệu + UI + logic lớn trong cùng PR.
   - Mỗi PR phải có checklist test và ảnh chụp màn hình (khi đổi UI).
4. Ưu tiên tiến hóa dần, tránh big-bang rewrite.

---

Tài liệu này là bước “đọc cấu trúc + chẩn đoán rủi ro + kế hoạch an toàn” trước khi bắt đầu refactor/đổi giao diện lớn.
