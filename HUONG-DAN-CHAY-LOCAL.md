# Chat Gemini và xem token trên TokenScope Web

Sau khi cài lần đầu, mở PowerShell ở thư mục `BE_tokenScope` và chạy một lệnh:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File ".\scripts\start-tokenscope.ps1"
```

1. Khi PowerShell hỏi `Paste Gemini API key`, dán khóa của bạn. Script lưu khóa đã mã hóa trên máy sau lượt gọi thành công đầu tiên và tự dùng lại lần sau.
2. Gõ câu hỏi ở dòng `You:` rồi nhấn **Enter**. Gemini trả lời và PowerShell in tổng số token của lượt vừa gọi.
3. Mở [TokenScope Web](http://127.0.0.1:8100/) và đăng nhập bằng `demo@tokenscope.io` / `123456`. Vào **Lịch sử** để xem từng lượt hoặc **Tổng quan → Truy vấn gần nhất** để xem lượt mới. Nếu web đã mở, nhấn **F5** sau khi Gemini trả lời.
4. Gõ `exit` ở dòng `You:` để thoát chat.
