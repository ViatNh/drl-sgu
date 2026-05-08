# 🚀 Hướng dẫn Triển khai Hệ thống DCT1253

Hướng dẫn từng bước chi tiết để triển khai toàn bộ hệ thống Tra cứu Điểm Hoạt động.

---

## Mục lục

1. [Bước 1: Tạo Google Sheet Master_DCT1253](#bước-1-tạo-google-sheet-master_dct1253)
2. [Bước 2: Cài đặt Google Apps Script](#bước-2-cài-đặt-google-apps-script)
3. [Bước 3: Deploy Web App (Backend API)](#bước-3-deploy-web-app-backend-api)
4. [Bước 4: Cài Trigger tự động](#bước-4-cài-trigger-tự-động)
5. [Bước 5: Deploy Frontend lên GitHub Pages](#bước-5-deploy-frontend-lên-github-pages)
6. [Bước 6: Cấu hình Custom Domain (tùy chọn)](#bước-6-cấu-hình-custom-domain-tùy-chọn)
7. [Bước 7: Cài đặt Python CLI Admin](#bước-7-cài-đặt-python-cli-admin)
8. [Bước 8: Kiểm tra toàn bộ hệ thống](#bước-8-kiểm-tra-toàn-bộ-hệ-thống)
9. [Xử lý sự cố thường gặp](#xử-lý-sự-cố-thường-gặp)

---

## Bước 1: Tạo Google Sheet Master_DCT1253

### 1.1 Tạo Sheet mới

1. Truy cập [sheets.google.com](https://sheets.google.com)
2. Nhấn **+ Trang tính mới** (Blank spreadsheet)
3. Đổi tên thành **Master_DCT1253**
4. Tạo 2 sheet con:
   - **Master** — chứa dữ liệu điểm tổng hợp
   - **Log** — ghi nhật ký chạy ETL

### 1.2 Thiết lập sheet Master

Thêm hàng tiêu đề vào sheet **Master** (dòng 1):

| A | B | C | D | E | F | G |
|---|---|---|---|---|---|---|
| MSSV | Họ tên | Tên hoạt động | Số điểm | Ngày thực hiện | File gốc | Sheet gốc |

> 💡 **Mẹo**: Có thể để trống, Apps Script sẽ tự tạo tiêu đề khi chạy lần đầu.

### 1.3 Thiết lập sheet Log

Thêm hàng tiêu đề vào sheet **Log** (dòng 1):

| A | B | C | D | E | F |
|---|---|---|---|---|---|
| Thời gian | Trạng thái | Số file | Số bản ghi | Thời gian chạy | Chi tiết |

### 1.4 Lưu Sheet ID

- Nhìn lên URL trình duyệt: `https://docs.google.com/spreadsheets/d/XXXXXXXXXXX/edit`
- Copy phần `XXXXXXXXXXX` — đây chính là **Spreadsheet ID**
- Lưu lại để dùng ở bước sau.

---

## Bước 2: Cài đặt Google Apps Script

### 2.1 Mở Apps Script Editor

Từ Google Sheet vừa tạo:
1. Menu **Tiện ích mở rộng** (Extensions) → **Apps Script**
2. Giao diện Apps Script sẽ mở ra trong tab mới.
3. Đổi tên project thành **DCT1253_TraCuuDiem**

### 2.2 Copy code

1. Mở file `google-apps-script/Code.gs` trong thư mục dự án.
2. Copy **toàn bộ** nội dung.
3. Dán vào Apps Script Editor, thay thế code mặc định `function myFunction() {}`.
4. Nhấn **Ctrl+S** để lưu.

### 2.3 Cấu hình

Tìm dòng sau trong code:

```javascript
var CONFIG = {
  DRIVE_FOLDER_ID: 'YOUR_DRIVE_FOLDER_ID',  // ← THAY BẰNG ID THẬT
  ...
};
```

#### Cách lấy Drive Folder ID:

1. Truy cập [drive.google.com](https://drive.google.com)
2. Mở thư mục Khoa chứa các file điểm.
3. Nhìn URL: `https://drive.google.com/drive/folders/YYYYYYYYYYYYYYY`
4. Copy phần `YYYYYYYYYYYYYYY` — đây là **Folder ID**.

Thay `'YOUR_DRIVE_FOLDER_ID'` bằng Folder ID thật:

```javascript
var CONFIG = {
  DRIVE_FOLDER_ID: '1aBcDeFgHiJkLmNoPqRsTuVwXyZ',  // ID thư mục Khoa
  CACHE_DURATION: 21600,
  TARGET_CLASS: 'DCT1253',
};
```

### 2.4 Test thủ công ETL Pipeline

1. Trong Apps Script Editor, chọn hàm `testETL` từ dropdown (gần nút Run).
2. Nhấn **Run**.
3. Lần đầu chạy sẽ yêu cầu cấp quyền:
   - Nhấn **Review permissions**
   - Chọn tài khoản Google
   - Nhấn **Advanced** → **Go to DCT1253_TraCuuDiem (unsafe)**
   - Nhấn **Allow** để cấp quyền đọc Drive + ghi Sheet.
4. Chờ script chạy xong (có thể 30s-2 phút tùy số lượng file).
5. Kiểm tra sheet **Master** — phải có dữ liệu.
6. Kiểm tra sheet **Log** — phải có dòng log mới.

> ⚠️ **Nếu gặp lỗi**: Xem sheet Log và mục [Xử lý sự cố](#xử-lý-sự-cố-thường-gặp).

---

## Bước 3: Deploy Web App (Backend API)

### 3.1 Deploy lần đầu

1. Trong Apps Script Editor, nhấn **Deploy** (góc trên phải) → **New deployment**.
2. Chọn loại: **Web App**.
3. Điền thông tin:
   - **Description**: `DCT1253 API v1.0`
   - **Execute as**: `Me (your.email@gmail.com)`
   - **Who has access**: `Anyone` (cho phép sinh viên truy cập công khai)
4. Nhấn **Deploy**.
5. Copy URL Web App hiện ra (dạng `https://script.google.com/macros/s/XXXXX/exec`).

> 📝 **Lưu URL này cẩn thận!** Đây là API endpoint cho Frontend và Python CLI.

### 3.2 Test API

Mở trình duyệt, truy cập URL vừa copy:

```
https://script.google.com/macros/s/XXXXX/exec
```

Phải thấy JSON response dạng:

```json
{
  "status": "ok",
  "message": "API Tra cứu Điểm Hoạt động DCT1253",
  "usage": { ... }
}
```

Test với MSSV:

```
https://script.google.com/macros/s/XXXXX/exec?mssv=2251234567
```

### 3.3 Cập nhật khi sửa code

Mỗi khi sửa code Apps Script, cần deploy lại:

1. **Deploy** → **Manage deployments**.
2. Nhấn biểu tượng ✏️ (Edit) ở deployment hiện tại.
3. Chọn Version: **New version**.
4. Nhấn **Deploy**.

> 💡 URL không thay đổi khi update cùng một deployment.

---

## Bước 4: Cài Trigger tự động

### 4.1 Cài Trigger

1. Trong Apps Script Editor, chọn hàm `setupDailyTrigger` từ dropdown.
2. Nhấn **Run**.
3. Kiểm tra: **Triggers** (đồng hồ bên trái) → Phải thấy trigger `updateMasterDCT1253` chạy lúc 2:00 AM.

### 4.2 Xác nhận

- Trigger sẽ chạy trong khoảng 2:00 - 3:00 AM mỗi ngày.
- Để chạy thử ngay, dùng hàm `testETL`.

### 4.3 Quản lý Trigger

- **Xem tất cả trigger**: Chạy hàm `listTriggers` → xem log.
- **Xóa tất cả trigger**: Chạy hàm `clearAllTriggers`.

---

## Bước 5: Deploy Frontend lên GitHub Pages

### 5.1 Tạo GitHub Repository

1. Truy cập [github.com/new](https://github.com/new)
2. Đặt tên: `dct1253-tra-cuu-diem` (hoặc tên khác)
3. Chọn **Public**.
4. Không chọn "Add a README file" (đã có sẵn).
5. Nhấn **Create repository**.

### 5.2 Push code lên GitHub

```bash
# Clone repo về máy
cd ~/dct1253-system
git init
git add frontend/ README.md .gitignore
git commit -m "Initial commit: DCT1253 score lookup system"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/dct1253-tra-cuu-diem.git
git push -u origin main
```

### 5.3 Cấu hình API URL trong Frontend

**Quan trọng**: Trước khi push, sửa file `frontend/script.js`, thay URL API:

```javascript
const CONFIG = {
  API_BASE_URL: 'https://script.google.com/macros/s/XXXXX/exec',
  // Thay bằng URL Web App từ Bước 3
  ...
};
```

### 5.4 Bật GitHub Pages

1. Trên GitHub repo → **Settings** → **Pages**.
2. **Source**: `Deploy from a branch`.
3. **Branch**: `main` → `/ (root)` → Save.
4. Đợi 1-2 phút, GitHub sẽ hiển thị URL: `https://YOUR_USERNAME.github.io/dct1253-tra-cuu-diem/`

> Nếu bạn muốn deploy thư mục `frontend/` riêng, thay Source branch thành `/docs` và đổi tên `frontend/` thành `docs/`.

### 5.5 Kiểm tra Frontend

1. Truy cập URL GitHub Pages.
2. Nhập MSSV → nhấn Kiểm tra → phải hiển thị kết quả.
3. Test trên mobile (responsive).

### 5.6 Tạo .gitignore

Tạo file `.gitignore` trong thư mục gốc:

```gitignore
# Python
__pycache__/
*.py[cod]
*.egg-info/

# Config
admin/config.json
~/.dct_admin/

# IDE
.vscode/
.idea/

# OS
.DS_Store
Thumbs.db
```

---

## Bước 6: Cấu hình Custom Domain (tùy chọn)

### 6.1 Mua/chuẩn bị domain

Bạn cần sở hữu 1 domain (VD: `dct1253.com` hoặc `dct1253.khoacntt.edu.vn`).

### 6.2 Cấu hình GitHub Pages

1. Vào Settings → Pages của repo.
2. Mục **Custom domain**: nhập domain (VD: `dct1253.khoacntt.edu.vn`).
3. Nhấn **Save**.
4. Chọn **Enforce HTTPS** (sau khi DNS propagate).

### 6.3 Cấu hình DNS

Tại nhà cung cấp domain, thêm bản ghi:

**Nếu dùng apex domain (dct1253.com):**

| Type | Name | Value |
|------|------|-------|
| A | @ | 185.199.108.153 |
| A | @ | 185.199.109.153 |
| A | @ | 185.199.110.153 |
| A | @ | 185.199.111.153 |

**Nếu dùng subdomain (tra-cuu.khoacntt.edu.vn):**

| Type | Name | Value |
|------|------|-------|
| CNAME | tra-cuu | YOUR_USERNAME.github.io |

Đợi DNS propagate (có thể mất vài phút đến 24h).

---

## Bước 7: Cài đặt Python CLI Admin

### 7.1 Cài đặt dependencies

```bash
cd ~/dct1253-system/admin
pip install requests tabulate
```

### 7.2 Cấu hình API URL

```bash
python dct_admin.py config --set-url "https://script.google.com/macros/s/XXXXX/exec"
```

Hoặc dùng biến môi trường:

```bash
export DCT1253_API_URL="https://script.google.com/macros/s/XXXXX/exec"
```

### 7.3 Test

```bash
# Kiểm tra API
python dct_admin.py health

# Tra cứu điểm
python dct_admin.py check 2251234567

# Xem thống kê
python dct_admin.py stats

# Top sinh viên
python dct_admin.py top --limit 5
```

---

## Bước 8: Kiểm tra toàn bộ hệ thống

### Checklist

- [ ] **Sheet Master_DCT1253** có dữ liệu (sau khi chạy testETL)
- [ ] **Sheet Log** có ghi nhận log SUCCESS
- [ ] **Web App URL** trả về JSON khi truy cập
- [ ] **API ?mssv=...** trả về đúng điểm sinh viên
- [ ] **Frontend GitHub Pages** load được và hiển thị kết quả
- [ ] **Python CLI** chạy đúng tất cả lệnh
- [ ] **Trigger** đã được cài đặt (kiểm tra trong Apps Script Triggers)
- [ ] **Mobile responsive** (test trên điện thoại)
- [ ] **Custom domain** (nếu có) trỏ đúng GitHub Pages

### Test các trường hợp đặc biệt

| Test case | Kết quả mong đợi |
|-----------|-----------------|
| MSSV không tồn tại | "Không tìm thấy sinh viên..." |
| MSSV < 6 số | "MSSV không hợp lệ..." |
| MSSV có chữ | Input tự động lọc, chỉ nhận số |
| API offline | "Không thể kết nối đến máy chủ..." |
| Refresh trang | Lịch sử MSSV vẫn hiển thị |
| Mobile view | Giao diện hiển thị đẹp, nút full-width |

---

## Xử lý sự cố thường gặp

### ❌ Apps Script: "Cannot read property 'getFolderById'"

**Nguyên nhân**: Chưa cấp quyền Drive hoặc Folder ID sai.

**Cách fix**:
1. Kiểm tra lại Folder ID trong `CONFIG.DRIVE_FOLDER_ID`.
2. Vào Google Drive, mở thư mục Khoa → copy ID từ URL.
3. Đảm bảo tài khoản Google có ít nhất quyền **Viewer** với thư mục.

### ❌ Apps Script: "Exceeded maximum execution time"

**Nguyên nhân**: Quá nhiều file/sheet, script chạy quá 6 phút.

**Cách fix**:
1. Kiểm tra số lượng file trong thư mục Khoa.
2. Nếu > 50 file, cân nhắc tách thư mục hoặc tối ưu code.
3. Giải pháp nâng cao: Thêm checkpoint, xử lý theo batch qua nhiều lần trigger.

### ❌ Web App: "Script function not found: doGet"

**Nguyên nhân**: Chưa deploy đúng cách hoặc sai deployment type.

**Cách fix**:
1. Kiểm tra code có hàm `doGet(e)` không.
2. Deploy lại với type **Web App** (không phải API Executable).
3. Đảm bảo "Who has access" = "Anyone".

### ❌ Frontend: CORS error khi fetch API

**Nguyên nhân**: Web App chưa được deploy với access "Anyone".

**Cách fix**:
1. Deploy lại Web App với "Who has access" = "Anyone".
2. Nếu đã deploy, vào Manage Deployments → Edit → đổi access → Deploy.

### ❌ Frontend: Trang trắng, không load

**Nguyên nhân**: Tailwind CDN bị chặn, hoặc lỗi JavaScript.

**Cách fix**:
1. Mở Developer Console (F12) xem lỗi.
2. Kiểm tra `API_BASE_URL` trong `script.js` đã được cập nhật.
3. Đảm bảo file `script.js` và `style.css` được push lên GitHub.

### ❌ Python CLI: "Chưa cấu hình API URL"

**Nguyên nhân**: Chưa chạy lệnh config.

**Cách fix**:
```bash
python dct_admin.py config --set-url "URL_CUA_BAN"
```

### ❌ Trigger không chạy

**Nguyên nhân**: Trigger bị lỗi hoặc hết quota.

**Cách fix**:
1. Kiểm tra **Executions** trong Apps Script (xem log lỗi).
2. Đảm bảo code không có lỗi runtime.
3. Chạy `setupDailyTrigger()` lần nữa.

---

## 📞 Hỗ trợ

Nếu gặp vấn đề không có trong tài liệu này, kiểm tra:

1. **Sheet Log** — xem dòng log gần nhất để biết lỗi.
2. **Apps Script Executions** — xem chi tiết lỗi runtime.
3. **GitHub Actions** — nếu dùng GitHub Pages với custom build.

---

**Chúc triển khai thành công! 🎉**
