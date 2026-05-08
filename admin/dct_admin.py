#!/usr/bin/env python3
"""
============================================================================
HỆ THỐNG TRA CỨU ĐIỂM HOẠT ĐỘNG DCT1253 - Python CLI Admin Tool
============================================================================
File: dct_admin.py
Mô tả: Công cụ dòng lệnh cho Admin để quản lý và tra cứu dữ liệu điểm.
       Giao tiếp với Google Apps Script Web App API.

Cài đặt:
    pip install requests tabulate

Sử dụng:
    python dct_admin.py check 225xxxx      # Tra cứu điểm 1 sinh viên
    python dct_admin.py export             # Xuất toàn bộ dữ liệu ra CSV
    python dct_admin.py stats              # Thống kê tổng quan
    python dct_admin.py top                # Top sinh viên
    python dct_admin.py activities         # Top hoạt động
    python dct_admin.py health             # Kiểm tra API
    python dct_admin.py config             # Cấu hình API URL
============================================================================
"""

import argparse
import csv
import json
import os
import sys
from datetime import datetime
from pathlib import Path

try:
    import requests
except ImportError:
    print("❌ Thiếu thư viện 'requests'. Cài đặt: pip install requests")
    sys.exit(1)

try:
    from tabulate import tabulate
    HAS_TABULATE = True
except ImportError:
    HAS_TABULATE = False
    print("⚠️  Không có 'tabulate'. Cài đặt để có bảng đẹp hơn: pip install tabulate")
    print()

# ═══════════════════════════════════════════════════════════════════════════
# CẤU HÌNH
# ═══════════════════════════════════════════════════════════════════════════

# File cấu hình lưu API URL
CONFIG_DIR = Path.home() / '.dct_admin'
CONFIG_FILE = CONFIG_DIR / 'config.json'

def load_config():
    """Đọc cấu hình API URL từ file."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {'api_url': None}

def save_config(config):
    """Lưu cấu hình."""
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

def get_api_url():
    """Lấy API URL từ cấu hình hoặc biến môi trường."""
    # Ưu tiên biến môi trường
    env_url = os.environ.get('DCT1253_API_URL')
    if env_url:
        return env_url
    
    # Sau đó đến file cấu hình
    config = load_config()
    return config.get('api_url')

# ═══════════════════════════════════════════════════════════════════════════
# API CALLS
# ═══════════════════════════════════════════════════════════════════════════

def call_api(params, timeout=15):
    """
    Gọi API Google Apps Script.
    
    Args:
        params: Dict chứa tham số query string
        timeout: Timeout (giây)
    
    Returns:
        Dict: JSON response từ API
    """
    api_url = get_api_url()
    if not api_url:
        print("❌ Chưa cấu hình API URL.")
        print("   Chạy lệnh sau để cấu hình:")
        print("   python dct_admin.py config --set-url <API_URL>")
        sys.exit(1)
    
    try:
        response = requests.get(api_url, params=params, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.Timeout:
        print("❌ API không phản hồi (timeout). Kiểm tra kết nối mạng.")
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print("❌ Không thể kết nối đến API. Kiểm tra URL và kết nối mạng.")
        sys.exit(1)
    except requests.exceptions.HTTPError as e:
        print(f"❌ Lỗi HTTP: {e}")
        sys.exit(1)
    except json.JSONDecodeError:
        print("❌ API trả về dữ liệu không phải JSON.")
        sys.exit(1)


# ═══════════════════════════════════════════════════════════════════════════
# COMMANDS
# ═══════════════════════════════════════════════════════════════════════════

def cmd_check(mssv):
    """Tra cứu điểm của một sinh viên."""
    if not mssv.isdigit() or len(mssv) < 6:
        print("❌ MSSV không hợp lệ. Phải là số, tối thiểu 6 chữ số.")
        return
    
    print(f"🔍 Đang tra cứu MSSV: {mssv}...")
    data = call_api({'mssv': mssv})
    
    if data.get('status') == 'ok':
        print()
        print("=" * 60)
        print(f"  🎓 {data['ho_ten']}")
        print(f"  MSSV: {data['mssv']}")
        print(f"  Lớp: DCT1253")
        print("=" * 60)
        print(f"  🏆 TỔNG ĐIỂM: {data['tong_diem']} điểm")
        print(f"  📊 Số hoạt động: {data['so_hoat_dong']}")
        print(f"  🕐 Cập nhật: {data.get('cap_nhat_luc', 'N/A')}")
        if data.get('_cached'):
            print(f"  💾 (dữ liệu từ cache)")
        print("=" * 60)
        
        if data.get('chi_tiet'):
            print()
            print("📋 CHI TIẾT HOẠT ĐỘNG:")
            print("-" * 60)
            
            rows = []
            for item in data['chi_tiet']:
                rows.append([
                    item['ten_hoat_dong'],
                    f"+{item['so_diem']}",
                    item.get('ngay', 'N/A'),
                ])
            
            if HAS_TABULATE:
                print(tabulate(rows, headers=['Hoạt động', 'Điểm', 'Ngày'], 
                              tablefmt='simple', colalign=('left', 'center', 'center')))
            else:
                for row in rows:
                    print(f"  • {row[0]:<40s} {row[1]:>6s}  {row[2]}")
            
            print("-" * 60)
    
    elif data.get('status') == 'not_found':
        print(f"\n⚠️  {data.get('message', 'Không tìm thấy sinh viên')}")
    else:
        print(f"\n❌ {data.get('message', 'Lỗi không xác định')}")


def cmd_export(format='csv'):
    """
    Xuất toàn bộ dữ liệu.
    Lưu ý: API public không hỗ trợ export toàn bộ (bảo mật).
    Thay vào đó dùng stats để lấy tổng quan.
    """
    print("📥 Đang lấy dữ liệu thống kê...")
    
    # Lấy stats trước
    stats = call_api({'action': 'stats'})
    
    if stats.get('status') != 'ok':
        print(f"❌ {stats.get('message', 'Lỗi')}")
        return
    
    # Tạo tên file với timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    if format == 'csv':
        filename = f'dct1253_stats_{timestamp}.csv'
        filepath = Path.cwd() / filename
        
        with open(filepath, 'w', newline='', encoding='utf-8-sig') as f:
            writer = csv.writer(f)
            
            # Sheet 1: Tổng quan
            writer.writerow(['=== THỐNG KÊ TỔNG QUAN ==='])
            writer.writerow(['Chỉ số', 'Giá trị'])
            writer.writerow(['Tổng sinh viên', stats['tong_sinh_vien']])
            writer.writerow(['Tổng bản ghi', stats['tong_ban_ghi']])
            writer.writerow(['Tổng điểm toàn lớp', stats['tong_diem_toan_lop']])
            writer.writerow(['Điểm trung bình', stats['diem_trung_binh']])
            writer.writerow(['Cập nhật lúc', stats['cap_nhat_luc']])
            writer.writerow([])
            
            # Sheet 2: Top sinh viên
            writer.writerow(['=== TOP SINH VIÊN ==='])
            writer.writerow(['MSSV', 'Tổng điểm'])
            for sv in stats.get('top_sinh_vien', []):
                writer.writerow([sv['mssv'], sv['tong_diem']])
            writer.writerow([])
            
            # Sheet 3: Top hoạt động
            writer.writerow(['=== TOP HOẠT ĐỘNG ==='])
            writer.writerow(['Tên hoạt động', 'Số lượt'])
            for hd in stats.get('top_hoat_dong', []):
                writer.writerow([hd['ten'], hd['so_luong']])
        
        print(f"✅ Đã xuất ra file: {filepath}")
        print(f"   Kích thước: {filepath.stat().st_size:,} bytes")
    
    elif format == 'json':
        filename = f'dct1253_stats_{timestamp}.json'
        filepath = Path.cwd() / filename
        
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
        
        print(f"✅ Đã xuất ra file: {filepath}")
        print(f"   Kích thước: {filepath.stat().st_size:,} bytes")


def cmd_stats():
    """Hiển thị thống kê tổng quan."""
    print("📊 Đang lấy thống kê...")
    data = call_api({'action': 'stats'})
    
    if data.get('status') != 'ok':
        print(f"❌ {data.get('message', 'Lỗi')}")
        return
    
    print()
    print("=" * 60)
    print("  📊 THỐNG KÊ LỚP DCT1253")
    print("=" * 60)
    
    stats_rows = [
        ('Tổng sinh viên', str(data['tong_sinh_vien'])),
        ('Tổng bản ghi hoạt động', str(data['tong_ban_ghi'])),
        ('Tổng điểm toàn lớp', f"{data['tong_diem_toan_lop']} điểm"),
        ('Điểm trung bình / SV', f"{data['diem_trung_binh']} điểm"),
        ('Cập nhật lần cuối', data.get('cap_nhat_luc', 'N/A')),
    ]
    
    if HAS_TABULATE:
        print(tabulate(stats_rows, headers=['Chỉ số', 'Giá trị'], 
                      tablefmt='simple', colalign=('left', 'right')))
    else:
        for label, value in stats_rows:
            print(f"  {label:<30s} {value:>20s}")
    
    print("=" * 60)


def cmd_top(limit=10):
    """Hiển thị top sinh viên."""
    print(f"🏆 Đang lấy top {limit} sinh viên...")
    data = call_api({'action': 'stats'})
    
    if data.get('status') != 'ok':
        print(f"❌ {data.get('message', 'Lỗi')}")
        return
    
    top_students = data.get('top_sinh_vien', [])[:limit]
    
    if not top_students:
        print("⚠️  Chưa có dữ liệu.")
        return
    
    print()
    print("=" * 50)
    print(f"  🏆 TOP {len(top_students)} SINH VIÊN CAO ĐIỂM NHẤT")
    print("=" * 50)
    
    rows = []
    for i, sv in enumerate(top_students, 1):
        # Medal cho top 3
        medal = {1: '🥇', 2: '🥈', 3: '🥉'}.get(i, f'{i:2d}.')
        rows.append([medal, sv['mssv'], f"{sv['tong_diem']} điểm"])
    
    if HAS_TABULATE:
        print(tabulate(rows, headers=['#', 'MSSV', 'Tổng điểm'], 
                      tablefmt='simple', colalign=('center', 'center', 'right')))
    else:
        for row in rows:
            print(f"  {row[0]:4s} {row[1]:12s} {row[2]:>10s}")
    
    print("=" * 50)


def cmd_activities(limit=10):
    """Hiển thị top hoạt động."""
    print(f"📋 Đang lấy top {limit} hoạt động...")
    data = call_api({'action': 'stats'})
    
    if data.get('status') != 'ok':
        print(f"❌ {data.get('message', 'Lỗi')}")
        return
    
    top_activities = data.get('top_hoat_dong', [])[:limit]
    
    if not top_activities:
        print("⚠️  Chưa có dữ liệu.")
        return
    
    print()
    print("=" * 70)
    print(f"  📋 TOP {len(top_activities)} HOẠT ĐỘNG PHỔ BIẾN NHẤT")
    print("=" * 70)
    
    rows = []
    for i, hd in enumerate(top_activities, 1):
        rows.append([f'{i:2d}.', hd['ten'], f"{hd['so_luong']} lượt"])
    
    if HAS_TABULATE:
        print(tabulate(rows, headers=['#', 'Tên hoạt động', 'Số lượt tham gia'], 
                      tablefmt='simple', colalign=('center', 'left', 'right')))
    else:
        for row in rows:
            print(f"  {row[0]:4s} {row[1]:<45s} {row[2]:>10s}")
    
    print("=" * 70)


def cmd_health():
    """Kiểm tra trạng thái API."""
    print("🏥 Đang kiểm tra API...")
    try:
        data = call_api({'action': 'health'}, timeout=10)
        
        if data.get('status') == 'ok':
            print()
            print("✅ API HOẠT ĐỘNG BÌNH THƯỜNG")
            print(f"   Version: {data.get('version', 'N/A')}")
            print(f"   Lớp: {data.get('class', 'N/A')}")
            print(f"   Server time: {data.get('timestamp', 'N/A')}")
        else:
            print(f"⚠️  API trả về trạng thái lạ: {data}")
    except SystemExit:
        # call_api đã in lỗi và exit
        pass


def cmd_config(args):
    """Quản lý cấu hình."""
    config = load_config()
    
    if hasattr(args, 'set_url') and args.set_url:
        config['api_url'] = args.set_url
        save_config(config)
        print(f"✅ Đã lưu API URL: {args.set_url}")
        print(f"   File cấu hình: {CONFIG_FILE}")
    
    elif hasattr(args, 'show') and args.show:
        print("📋 Cấu hình hiện tại:")
        print(f"   API URL: {config.get('api_url') or 'Chưa cấu hình'}")
        print(f"   File cấu hình: {CONFIG_FILE}")
        env_url = os.environ.get('DCT1253_API_URL')
        if env_url:
            print(f"   Env DCT1253_API_URL: {env_url} (ưu tiên)")
    
    else:
        print("📋 Cấu hình hiện tại:")
        print(f"   API URL: {config.get('api_url') or 'Chưa cấu hình'}")
        print()
        print("Cách cấu hình:")
        print("  1. Qua dòng lệnh:")
        print("     python dct_admin.py config --set-url <API_URL>")
        print("  2. Qua biến môi trường:")
        print("     export DCT1253_API_URL=<API_URL>")


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='🔧 DCT1253 Admin Tool - Quản lý điểm hoạt động lớp DCT1253',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ví dụ:
  python dct_admin.py check 2251234567    # Tra cứu điểm sinh viên
  python dct_admin.py export              # Xuất thống kê ra CSV
  python dct_admin.py stats               # Xem thống kê tổng quan
  python dct_admin.py top --limit 20      # Top 20 sinh viên
  python dct_admin.py activities          # Top hoạt động phổ biến
  python dct_admin.py health              # Kiểm tra API
  python dct_admin.py config --set-url https://script.google.com/...

Cấu hình API URL (chỉ cần làm 1 lần):
  python dct_admin.py config --set-url <API_URL>
  hoặc: export DCT1253_API_URL=<API_URL>
        """
    )
    
    subparsers = parser.add_subparsers(dest='command', help='Lệnh')
    
    # check
    p_check = subparsers.add_parser('check', help='Tra cứu điểm sinh viên')
    p_check.add_argument('mssv', help='Mã số sinh viên (VD: 2251234567)')
    
    # export
    p_export = subparsers.add_parser('export', help='Xuất dữ liệu thống kê')
    p_export.add_argument('--format', choices=['csv', 'json'], default='csv', 
                         help='Định dạng xuất (mặc định: csv)')
    
    # stats
    subparsers.add_parser('stats', help='Thống kê tổng quan')
    
    # top
    p_top = subparsers.add_parser('top', help='Top sinh viên cao điểm nhất')
    p_top.add_argument('--limit', type=int, default=10, help='Số lượng (mặc định: 10)')
    
    # activities
    p_act = subparsers.add_parser('activities', help='Top hoạt động phổ biến nhất')
    p_act.add_argument('--limit', type=int, default=10, help='Số lượng (mặc định: 10)')
    
    # health
    subparsers.add_parser('health', help='Kiểm tra trạng thái API')
    
    # config
    p_config = subparsers.add_parser('config', help='Cấu hình API URL')
    p_config.add_argument('--set-url', help='Cài đặt API URL')
    p_config.add_argument('--show', action='store_true', help='Hiển thị cấu hình')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    # Dispatch commands
    if args.command == 'check':
        cmd_check(args.mssv)
    elif args.command == 'export':
        cmd_export(args.format)
    elif args.command == 'stats':
        cmd_stats()
    elif args.command == 'top':
        cmd_top(args.limit)
    elif args.command == 'activities':
        cmd_activities(args.limit)
    elif args.command == 'health':
        cmd_health()
    elif args.command == 'config':
        cmd_config(args)


if __name__ == '__main__':
    main()
