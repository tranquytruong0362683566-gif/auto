# Phân tích mã nguồn đầu vào

## Extension gốc

Extension gốc dùng Manifest V3 và có các chức năng chính:

- Đọc toàn bộ cookie Facebook.
- Tạo mã nhận dạng máy.
- Dùng service worker làm proxy request để tránh CORS.
- Sửa các header bị cấm đặt trực tiếp bởi `fetch`, gồm `cookie`, `origin`, `referer`.
- Hỗ trợ body văn bản, multipart và binary base64.
- Có cấu hình proxy toàn Chrome và luồng lấy token Business.

Bản mới giữ cầu nối cookie/request nhưng bỏ các quyền không liên quan như CPU, memory, storage device, proxy và webRequest auth.

## Đăng Reels Page

Mã gốc có ba biến thể đăng Reels. Biến thể phù hợp nhất cho Page là `reels_ver3` kết hợp `client_upload_api`:

1. Lấy `fb_dtsg`, `jazoest`, `c_user` và cookie.
2. Xác định `i_user` tương ứng Page.
3. Khởi tạo upload tại Business Facebook.
4. Upload video theo chunk 4 MB tới `rupload.facebook.com`.
5. Gửi `fbuploader_video_file_chunk` ở pha receive.
6. Publish bằng `ReelComposerReelPublishMutation`.

Bản mới đặt toàn bộ request trong service worker queue để không xảy ra race condition khi DNR rule dùng chung.

## Danh sách Page

Mã gốc lấy Page theo hai phương án:

- Graph API `/me/accounts` khi có token EAA.
- GraphQL `additional_profiles_with_biz_tools` khi dùng cookie.

Bản mới giữ cả hai phương án, ưu tiên token EAA nếu extension đã có, sau đó fallback sang GraphQL cookie.

## Quét nhóm

File `scan_group_members` trong mã gốc dùng GraphQL để quét thành viên mới của nhóm, không phải link bài viết. Vì vậy bản mới tạo `facebook-scanner.js` riêng:

- Chỉ thao tác DOM trong tab Facebook.
- Dùng selector `role=feed`, `role=main`, `role=article`.
- Không phụ thuộc class CSS động.
- Nhận diện `/posts/`, `/permalink/`, `story_fbid`.
- Có timeout, số vòng cuộn tối đa, stale rounds và lệnh dừng.
