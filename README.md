# TQT Page Reels & Group Scanner

Bộ mã nguồn gồm hai phần:

- **GitHub Pages**: giao diện chọn Page, tạo hàng đợi đăng Reels, cấu hình quét nhóm, hiển thị tiến trình và xuất CSV.
- **Chrome Extension Manifest V3**: đọc cookie Facebook, gửi request tới Facebook/Business Suite, upload video theo chunk và mở tab nhóm để quét DOM.

## Cấu trúc

```text
fb-page-reels-group-scanner/
├── index.html
├── assets/
│   └── style.css
├── js/
│   ├── extension-client.js
│   ├── facebook-api.js
│   ├── reels.js
│   └── app.js
└── extension/
    ├── manifest.json
    ├── background.js
    ├── bridge.js
    ├── facebook-scanner.js
    ├── popup.html
    ├── popup.js
    └── icons/
```

## Logic đăng Reels Page

1. Web gửi lệnh lấy phiên Facebook qua `bridge.js`.
2. `background.js` đọc cookie bằng `chrome.cookies`.
3. Web lấy `fb_dtsg`, `jazoest`, danh sách Page và `i_user`.
4. Video được upload theo luồng:
   - `ajax/video/upload/requests/start`
   - `rupload.facebook.com` theo chunk 4 MB
   - `ajax/video/upload/requests/receive`
   - GraphQL `ReelComposerReelPublishMutation`
5. Mỗi request được service worker đưa vào hàng đợi tuần tự để rule sửa `cookie/origin/referer` không ghi đè lẫn nhau.
6. Có khóa chống chạy hai tiến trình Reels, `AbortController`, timeout và retry publish giới hạn.

## Logic quét link bài viết nhóm

1. Web chuẩn hóa Group ID và gửi `START_GROUP_SCAN`.
2. Service worker chỉ cho chạy một tab quét tại một thời điểm.
3. Tab được mở với `sorting_setting=CHRONOLOGICAL` khi chọn chế độ bài mới.
4. `facebook-scanner.js` chờ feed, quét từng `role=article`, bỏ bài ghim nếu bật tùy chọn.
5. Link được nhận từ các dạng `/posts/`, `/permalink/` hoặc `story_fbid`, sau đó chuẩn hóa và loại trùng.
6. Tiến trình dừng khi đủ số link, hết số lần cuộn hoặc không xuất hiện link mới qua nhiều vòng.
7. MutationObserver được tạo theo từng lần chờ và luôn `disconnect` khi hoàn thành/timeout.

## Đưa Web lên GitHub Pages

### Cách 1: Dùng repository `auto`

1. Tạo hoặc mở repository `auto` trong tài khoản GitHub `tranquytruong0362683566-gif`.
2. Upload toàn bộ file và thư mục ở cấp gốc của gói này, ngoại trừ có thể giữ nguyên thư mục `extension`.
3. Vào **Settings → Pages**.
4. Chọn **Deploy from a branch**.
5. Chọn branch `main`, thư mục `/ (root)` rồi lưu.
6. Web mặc định:

```text
https://tranquytruong0362683566-gif.github.io/auto/
```

### Cách 2: Dùng repository tên khác

`manifest.json`, `bridge.js` và `background.js` hiện chỉ cho phép hostname `tranquytruong0362683566-gif.github.io` cùng localhost. Nếu đổi sang tài khoản GitHub khác hoặc tên miền riêng, hãy cập nhật hostname đồng bộ trong ba file này; nếu chỉ đổi tên repository trong cùng tài khoản thì không cần đổi hostname.

## Cài Extension

1. Mở Chrome và truy cập `chrome://extensions`.
2. Bật **Chế độ dành cho nhà phát triển**.
3. Chọn **Tải tiện ích đã giải nén**.
4. Chọn đúng thư mục `extension`.
5. Đăng nhập Facebook ở `https://www.facebook.com/` bằng tư cách tài khoản cá nhân.
6. Mở web GitHub Pages và bấm **Kết nối lại**.

## Cách sử dụng

### Đăng Reels

1. Bấm **Tải danh sách Page**.
2. Chọn Page cần đăng.
3. Chọn một hoặc nhiều video MP4.
4. Nhập nội dung. Có thể dùng:
   - `{filename}` để chèn tên file.
   - `{mẫu một|mẫu hai|mẫu ba}` để chọn ngẫu nhiên một nội dung.
5. Chọn số Reel mỗi Page và thời gian chờ.
6. Bấm **Bắt đầu đăng Reels**.

### Quét nhóm

1. Nhập mỗi dòng một Group ID hoặc link nhóm.
2. Chọn số link mỗi nhóm, số lần cuộn và thời gian chờ.
3. Bấm **Bắt đầu quét nhóm**.
4. Dùng **Sao chép link** hoặc **Xuất CSV**.

## Các điểm đã kiểm soát

- Không tạo listener, timer hoặc MutationObserver lặp vô hạn.
- Request có timeout và retry giới hạn.
- Chỉ cho request tới các hostname Facebook đã khai báo.
- Chỉ website GitHub Pages/localhost mới được gọi service worker.
- Tab không tồn tại, bị đóng hoặc tải quá lâu đều trả mã lỗi riêng.
- Quét nhóm và đăng Reels đều có khóa chống chạy trùng.
- Kết quả link và cấu hình giao diện được lưu trong `localStorage`.
- Trạng thái tab quét được lưu trong `chrome.storage.session` để service worker có thể khôi phục thông tin khi thức lại.

## File tham chiếu từ mã nguồn gốc

Luồng mới được tái cấu trúc từ các phần đã phân tích:

- `EX/background.js`: proxy request, cookie và DNR header.
- `EX/bridge.js`: cầu nối web với extension.
- `client_upload_api_v=1779615998.js`: upload video Business Facebook theo start/chunk/receive.
- `reels_ver3_v=1779615998.js`: publish Reel bằng GraphQL.
- `script_v=1779615998.js`: lấy token, danh sách Page và `i_user`.

Phần quét link bài viết nhóm là module mới, vì `scan_group_members` trong mã gốc quét thành viên chứ không quét bài viết.
