# Trường Group Publisher

Web GitHub Pages và Chrome Extension phối hợp để đăng cùng một bài viết vào danh sách nhóm Facebook theo thứ tự.

## Chức năng

- Mặc định đăng **chỉ văn bản**.
- Có thể đính kèm tùy chọn **một ảnh** hoặc **một video**; web tự nhận loại tệp.
- Nhập danh sách UID nhóm dạng số và tự lọc trùng.
- Đăng tuần tự, đặt thời gian nghỉ giữa hai nhóm.
- Dừng, tiếp tục, bỏ qua nhóm lỗi và lưu kết quả thành công/thất bại.
- Xuất kết quả CSV hoặc JSON.
- Tự đọc token phiên và mã GraphQL đang dùng từ Facebook khi chạy.
- Chỉ dùng một tab Facebook nền cho cả hàng đợi; không mở từng nhóm.
- Không dùng quyền `debugger`, không đọc cookie bằng API extension và không cần request mẫu.
- Giới hạn tệp: ảnh 20 MB, video 200 MB.

## Cài extension

1. Tải và giải nén `Truong-Group-Publisher-Extension-v1.2.2.zip`.
2. Mở `chrome://extensions`.
3. Bật **Chế độ dành cho nhà phát triển**.
4. Chọn **Tải tiện ích đã giải nén**, sau đó chọn thư mục vừa giải nén.
5. Đăng nhập Facebook trong cùng hồ sơ Chrome.
6. Mở `https://tranquytruong0362683566-gif.github.io/auto/`.

Khi bắt đầu hàng đợi, extension tạo một tab Facebook không được chọn, dùng JavaScript trong ngữ cảnh Facebook để gửi request có phiên đăng nhập hợp lệ. Tab này được dùng lại cho mọi UID và tự đóng khi hàng đợi hoàn tất hoặc bị xóa.

## Cơ chế request

- Văn bản: gọi trực tiếp `ComposerStoryCreateMutation` với danh sách tệp đính kèm rỗng.
- Ảnh: upload multipart đến endpoint React Composer, nhận `photoID`, sau đó gọi `ComposerStoryCreateMutation`.
- Video: dùng chuỗi start → lấy offset Rupload → upload phần binary còn lại → receive, rồi gọi mutation tạo bài. Header và `upload_session_id` bám theo giao thức uploader của Facebook.
- Với Rupload, tên tệp trong HTTP header được mã hóa bằng `encodeURIComponent`, nên tên tiếng Việt hoặc emoji không làm Fetch API từ chối request; tên tệp gốc trên web không bị thay đổi.
- Mã `doc_id` của mutation được tìm từ Relay module hoặc tài nguyên JavaScript Facebook đang tải. Extension chỉ dùng danh sách dự phòng khi Facebook không công bố mã đó trong trang.
- Bài được Facebook tiếp nhận nhưng đang chờ quản trị viên duyệt vẫn được tính là thành công.
- Nếu một nhóm lỗi mạng hoặc bị Facebook từ chối, hàng đợi ghi nhận thất bại và tiếp tục nhóm kế tiếp.

## Lưu ý

Đây là request nội bộ của Facebook, không phải Graph API chính thức. Facebook có thể đổi endpoint, schema hoặc quy trình upload mà không báo trước. Kết quả lỗi hiển thị mã và thông điệp cụ thể để phân biệt lỗi đăng nhập, quyền nhóm, upload media, `doc_id` và GraphQL.

Chỉ đăng ở các nhóm nơi tài khoản có quyền và tuân thủ quy định của nhóm cũng như Facebook.

## Kiểm thử

```bash
npm test
npm run check
```
