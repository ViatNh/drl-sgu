# 🎓 Hệ thống Tra cứu Điểm Hoạt động - Lớp DCT1253

Hệ thống tự động tổng hợp và tra cứu điểm hoạt động cho sinh viên lớp **DCT1253** từ các file Google Sheet do Khoa cung cấp.

## 🏗️ Kiến trúc

```
┌─────────────────────────────────────────────────────────────┐
│                   GOOGLE DRIVE (Khoa)                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                    │
│  │ File A   │ │ File B   │ │ File C   │ ... (View-only)    │
│  │ (Sheet 1)│ │ (Sheet 1)│ │ (Sheet 1)│                    │
│  │ (Sheet 2)│ │ (Sheet 2)│ │ (Sheet 2)│                    │
│  └──────────┘ └──────────┘ └──────────┘                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ DriveApp.getFolderById()
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              GOOGLE APPS SCRIPT (ETL Pipeline)              │
│  updateMasterDCT1253() — Trigger 2:00 AM hàng ngày          │
│  • Quét tất cả file → Lọc DCT1253 → Trích xuất điểm        │
│  • Ghi vào Master_DCT1253 Google Sheet (bạn sở hữu)        │
├─────────────────────────────────────────────────────────────┤
│              GOOGLE APPS SCRIPT (Backend API)               │
│  doGet(e) — Web App (Anyone)                                │
│  • ?mssv=225xxxx → JSON điểm sinh viên                      │
│  • Cache 6 tiếng (CacheService)                             │
└──────────────┬──────────────────────────────────────────────┘
               │ HTTP JSON
               ▼
┌─────────────────────────────────────────────────────────────┐
│                   FRONTEND (GitHub Pages)                    │
│  • HTML + Tailwind CSS + Vanilla JS                         │
│  • Mobile-first, tối giản                                   │
│  • fetch() gọi API → hiển thị kết quả                      │
│  • Lịch sử MSSV (localStorage)                              │
└─────────────────────────────────────────────────────────────┘
                       │
┌──────────────────────┴──────────────────────────────────────┐
│                PYTHON CLI (Local Admin)                      │
│  • dct_admin.py check|export|stats|top|activities|health     │
│  • requests + argparse + tabulate                            │
└─────────────────────────────────────────────────────────────┘
```

## 📁 Cấu trúc dự án

```
dct1253-system/
├── README.md                          ← File này
├── DEPLOY.md                          ← Hướng dẫn triển khai chi tiết
├── google-apps-script/
│   └── Code.gs                        ← Toàn bộ Apps Script (ETL + API)
├── frontend/
│   ├── index.html                     ← Trang chính (Single Page App)
│   ├── script.js                      ← Logic frontend
│   ├── style.css                      ← CSS bổ sung
│   └── assets/                        ← Hình ảnh, favicon, ...
└── admin/
    └── dct_admin.py                   ← Python CLI Admin Tool
```

## 🚀 Triển khai nhanh (5 bước)

| Bước | Nội dung | Thời gian |
|------|----------|-----------|
| 1 | Tạo Google Sheet Master_DCT1253 | 2 phút |
| 2 | Copy Apps Script + Cấu hình | 5 phút |
| 3 | Deploy Web App + Lấy URL | 3 phút |
| 4 | Deploy Frontend lên GitHub Pages | 5 phút |
| 5 | Cài Trigger + Kiểm tra | 3 phút |

👉 **Xem hướng dẫn chi tiết từng bước trong [DEPLOY.md](./DEPLOY.md)**

## 🔧 Các lệnh Python CLI

```bash
# Cài đặt
pip install requests tabulate

# Cấu hình API URL (chỉ cần 1 lần)
python dct_admin.py config --set-url "https://script.google.com/macros/s/xxx/exec"

# Tra cứu điểm sinh viên
python dct_admin.py check 2251234567

# Xem thống kê tổng quan
python dct_admin.py stats

# Top 10 sinh viên cao điểm nhất
python dct_admin.py top

# Top 10 hoạt động phổ biến nhất
python dct_admin.py activities

# Xuất dữ liệu ra CSV
python dct_admin.py export

# Xuất dữ liệu ra JSON
python dct_admin.py export --format json

# Kiểm tra API
python dct_admin.py health
```

## 🔌 API Endpoints

| Endpoint | Mô tả | Ví dụ |
|----------|-------|-------|
| `?mssv=225xxxx` | Tra cứu điểm sinh viên | `?mssv=2251234567` |
| `?action=stats` | Thống kê tổng quan | `?action=stats` |
| `?action=health` | Health check | `?action=health` |

### Response mẫu (Tra cứu MSSV)

```json
{
  "status": "ok",
  "mssv": "2251234567",
  "ho_ten": "Nguyễn Văn A",
  "tong_diem": 12.5,
  "so_hoat_dong": 5,
  "chi_tiet": [
    {
      "ten_hoat_dong": "Tham gia hội thao",
      "so_diem": 3,
      "ngay": "15/03/2026",
      "file_goc": "Diem_Ren_Luyen_HK2.xlsx",
      "sheet_goc": "Sheet1"
    }
  ],
  "cap_nhat_luc": "08/05/2026 02:00:00"
}
```

### Response mẫu (Không tìm thấy)

```json
{
  "status": "not_found",
  "message": "Không tìm thấy sinh viên với MSSV 2259999999 trong lớp DCT1253.",
  "mssv": "2259999999"
}
```

## 🛡️ Bảo mật

- **Drive Folder ID** và **Web App URL** chỉ xuất hiện trong file cấu hình, không commit lên GitHub public.
- API public chỉ cho phép tra cứu theo MSSV (không export toàn bộ dữ liệu).
- Frontend không chứa API key hay ID nhạy cảm.
- Sử dụng `.gitignore` để không commit file cấu hình.

## 📊 Tính năng

### Frontend
- 🎨 Thiết kế mobile-first, hiện đại với Tailwind CSS
- 🔍 Auto-search khi nhập đủ MSSV + debounce
- 📋 Bảng chi tiết sortable (click vào tiêu đề cột)
- 📱 Chia sẻ kết quả qua Web Share API
- 💾 Lịch sử MSSV gần đây (localStorage)
- 🎬 Animation đếm điểm, loading spinner
- ♿ Accessibility (focus-visible, reduced-motion, screen-reader)
- 🖨️ Print styles

### Backend
- ⚡ Cache 6 tiếng với CacheService
- 📝 Logging chi tiết vào sheet Log
- 🔄 Tự động xóa cache khi ETL chạy xong
- 🛡️ Xử lý lỗi graceful (MSSV không tồn tại, API lỗi...)

### ETL Pipeline
- 🔍 Tự động nhận diện cột MSSV, Họ tên, Lớp
- 🧹 Regex trích xuất điểm từ tiêu đề (hỗ trợ nhiều format)
- 📊 Hỗ trợ tiếng Việt có dấu/không dấu
- ⚡ Ghi dữ liệu 1 lần duy nhất (tránh timeout)

## 📝 Yêu cầu hệ thống

| Thành phần | Yêu cầu |
|------------|---------|
| Google Account | Có (để tạo Sheet + Apps Script) |
| Quyền Drive | Ít nhất Reader với thư mục Khoa |
| GitHub Account | Có (để deploy GitHub Pages) |
| Python 3.8+ | Cho CLI Admin Tool |
| Domain (tùy chọn) | Nếu muốn custom domain cho GitHub Pages |

## 🎯 Lộ trình phát triển (ý tưởng mở rộng)

- [ ] Dark mode
- [ ] Tìm kiếm theo tên sinh viên
- [ ] Filter theo học kỳ
- [ ] Biểu đồ thống kê (Chart.js)
- [ ] So sánh điểm giữa các sinh viên
- [ ] Xuất PDF bảng điểm cá nhân
- [ ] PWA (cài đặt trên điện thoại)
- [ ] Telegram Bot tra cứu điểm

---

**Made with ❤️ by Hermes Agent**  
*Dự án dành cho lớp DCT1253 — Khoa Công Nghệ Thông Tin*
