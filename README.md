# Trường Group Publisher

Web GitHub Pages và Chrome Extension phối hợp để đăng cùng một bài viết vào danh sách nhóm Facebook theo thứ tự.

## Chức năng

- Chọn **một ảnh + văn bản** hoặc **một video + văn bản**.
- Nhập danh sách UID nhóm dạng số, tự lọc trùng.
- Đăng tuần tự và đặt thời gian nghỉ giữa hai nhóm.
- Dừng, tiếp tục, bỏ qua nhóm lỗi và lưu kết quả thành công/thất bại.
- Xuất kết quả CSV hoặc JSON.
- Khi vận hành bình thường, extension chỉ gửi request và không mở từng tab nhóm.
- Hiệu chuẩn riêng một lần cho ảnh và một lần cho video bằng tab Facebook do extension mở.
- Giới hạn tệp: ảnh 20 MB, video 200 MB.

## Cài extension

1. Tải và giải nén `Truong-Group-Publisher-Extension-v1.0.0.zip`.
2. Mở `chrome://extensions`.
3. Bật **Chế độ dành cho nhà phát triển**.
4. Chọn **Tải tiện ích đã giải nén**, sau đó chọn thư mục vừa giải nén.
5. Đăng nhập Facebook trong cùng hồ sơ Chrome và mở trang:
   `https://tranquytruong0362683566-gif.github.io/auto/`

## Hiệu chuẩn ban đầu

1. Nhập UID của một nhóm thử nghiệm mà tài khoản có quyền đăng.
2. Nhấn **Ghi mẫu ảnh**. Extension mở tab nhóm và hiển thị đoạn đánh dấu trên web.
3. Trên tab Facebook, tạo bài gồm đúng đoạn đánh dấu và một ảnh dưới 1 MB, đăng bài, rồi quay lại web nhấn **Đã đăng xong — hoàn tất ghi**.
4. Lặp lại bằng **Ghi mẫu video** với một video ngắn, dung lượng nhỏ.

Profile chỉ lưu cấu trúc request và các vị trí dữ liệu động. Extension không xin quyền đọc cookie; website không nhận cookie hay token Facebook. Khi chạy, service worker lấy token mới bằng request trong phiên đăng nhập hiện tại.

Quyền `debugger` chỉ được gắn vào tab Facebook do extension tạo trong lúc ghi mẫu. Khi bấm hoàn tất, extension tắt Network debugging, tháo debugger và đóng tab đó.

## Lưu ý vận hành

- Facebook có thể thay đổi request nội bộ. Khi profile báo lỗi hoặc Facebook thay giao diện, hãy dùng nút **Ghi lại**.
- Bài được Facebook tiếp nhận nhưng chờ quản trị viên duyệt vẫn được tính là thành công.
- Nếu một nhóm lỗi mạng hoặc bị từ chối, hàng đợi ghi nhận thất bại và tiếp tục nhóm sau.
- Chỉ đăng ở các nhóm nơi bạn có quyền và tuân thủ quy định của nhóm cũng như Facebook.

## Kiểm thử

```bash
npm test
npm run check
```
