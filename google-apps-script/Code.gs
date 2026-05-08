/**
 * ============================================================================
 * HỆ THỐNG TRA CỨU ĐIỂM HOẠT ĐỘNG - LỚP DCT1253
 * ============================================================================
 * File: Code.gs
 * Mô tả: Google Apps Script chứa toàn bộ logic ETL Pipeline + Backend API
 * Tác giả: ViatNh
 * Ngày tạo: 08/05/2026
 * ============================================================================
 * 
 * CẤU TRÚC GOOGLE SHEET YÊU CẦU:
 *   - Sheet "Master": chứa dữ liệu đã tổng hợp
 *     Cột: MSSV | Họ tên | Tên hoạt động | Số điểm | Ngày thực hiện | File gốc | Sheet gốc
 *   - Sheet "Log": ghi nhật ký chạy ETL
 *     Cột: Thời gian | Trạng thái | Số file | Số dòng | Ghi chú
 *
 * CẤU HÌNH (CHỈNH SỬA 2 DÒNG DƯỚI ĐÂY):
 *   - DRIVE_FOLDER_ID: ID thư mục Google Drive chứa file điểm của Khoa
 *   - CACHE_DURATION: thời gian cache API (giây), mặc định 6 giờ
 * ============================================================================
 */

// ═══════════════════════════════════════════════════════════════════════════
// CẤU HÌNH - THAY ĐỔI TẠI ĐÂY
// ═══════════════════════════════════════════════════════════════════════════
var CONFIG = {
  DRIVE_FOLDER_ID: '1TOgKamuzGi0EwYSdq3U5L8yhts0SWJHB',  // ID thư mục Drive của Khoa
  MASTER_SHEET_ID: '',                       // ← DÁN ID GOOGLE SHEET MASTER_DCT1253 VÀO ĐÂY
  CACHE_DURATION: 21600,                     // 6 giờ (giây)
  TARGET_CLASS: 'DCT1253',                   // Lớp cần lọc
};

/**
 * Lấy reference đến Spreadsheet Master_DCT1253.
 * Ưu tiên dùng MASTER_SHEET_ID nếu được cấu hình,
 * nếu không thì dùng Active Spreadsheet (khi Apps Script được tạo từ trong Sheet).
 */
function getMasterSpreadsheet() {
  if (CONFIG.MASTER_SHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.MASTER_SHEET_ID);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

// ═══════════════════════════════════════════════════════════════════════════
// PHẦN 1: DATA PIPELINE (ETL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hàm chính - chạy tự động bởi Trigger hàng ngày lúc 2:00 AM
 * Quét toàn bộ file Google Sheet trong thư mục Khoa, trích xuất điểm
 * của sinh viên lớp DCT1253, ghi vào sheet Master.
 */
function updateMasterDCT1253() {
  var startTime = new Date();
  var logMessages = [];
  
  logMessages.push('🚀 Bắt đầu quét dữ liệu lúc: ' + startTime.toLocaleString('vi-VN'));
  
  try {
    // Bước 1: Lấy thư mục Drive
    var folder = DriveApp.getFolderById(CONFIG.DRIVE_FOLDER_ID);
    logMessages.push('📁 Đã kết nối thư mục: ' + folder.getName());
    
    // Bước 2: Duyệt tất cả file Google Sheet
    var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    var allRecords = [];  // Mảng chứa tất cả bản ghi điểm
    var fileCount = 0;
    var skippedFiles = 0;
    
    while (files.hasNext()) {
      var file = files.next();
      fileCount++;
      
      try {
        var spreadsheet = SpreadsheetApp.openById(file.getId());
        var sheets = spreadsheet.getSheets();
        
        logMessages.push('  📄 [' + fileCount + '] ' + file.getName() + ' (' + sheets.length + ' sheet)');
        
        // Duyệt từng sheet con
        for (var s = 0; s < sheets.length; s++) {
          var sheet = sheets[s];
          var sheetName = sheet.getName();
          
          // Bỏ qua sheet rỗng
          var lastRow = sheet.getLastRow();
          if (lastRow < 2) {
            logMessages.push('      ⏭️ Sheet "' + sheetName + '" rỗng, bỏ qua');
            continue;
          }
          
          // Đọc toàn bộ dữ liệu
          var data = sheet.getDataRange().getValues();
          if (data.length < 2) continue;
          
          // Tìm vị trí các cột quan trọng từ hàng tiêu đề
          var headers = data[0];
          var colMap = findColumnIndexes(headers);
          
          if (!colMap.mssvCol && !colMap.nameCol) {
            // Sheet không có cột MSSV hoặc Họ tên → bỏ qua
            skippedFiles++;
            continue;
          }
          
          // Trích xuất điểm từ tiêu đề
          // DEBUG: In 20 cột tiêu đề đầu tiên để phân tích
          logMessages.push('      🔍 DEBUG headers[' + headers.length + ' cột]: ' + 
            headers.slice(0, 20).map(function(h, i) { return '[' + i + ']' + (h || '').toString().substring(0, 30); }).join(' | '));
          logMessages.push('      🔍 DEBUG colMap: mssvCol=' + colMap.mssvCol + ' nameCol=' + colMap.nameCol + ' classCol=' + colMap.classCol + ' dateCol=' + colMap.dateCol);
          
          var activityPoints = extractPointsFromHeaders(headers, colMap);
          
          logMessages.push('      🔍 DEBUG activityPoints: ' + Object.keys(activityPoints).length + ' cột điểm tìm thấy -> ' + 
            Object.keys(activityPoints).map(function(k) { return '[' + k + ']=' + activityPoints[k].name + '(' + activityPoints[k].point + 'đ)'; }).join(', '));
          
          if (Object.keys(activityPoints).length === 0) {
            logMessages.push('      ℹ️ Sheet "' + sheetName + '" không có cột điểm, bỏ qua');
            continue;
          }
          
          // Duyệt từng dòng dữ liệu (bỏ qua hàng tiêu đề)
          var recordsFromSheet = 0;
          for (var row = 1; row < data.length; row++) {
            var rowData = data[row];
            
            // Kiểm tra lớp
            var className = colMap.classCol >= 0 ? String(rowData[colMap.classCol] || '').trim().toUpperCase() : '';
            if (className !== CONFIG.TARGET_CLASS) continue;
            
            // Lấy MSSV và Họ tên
            var mssv = colMap.mssvCol >= 0 ? String(rowData[colMap.mssvCol] || '').trim() : '';
            var hoTen = colMap.nameCol >= 0 ? String(rowData[colMap.nameCol] || '').trim() : '';
            
            if (!mssv || !hoTen) continue;  // Bỏ qua dòng không có MSSV hoặc tên
            
            // Với mỗi cột hoạt động có điểm, kiểm tra xem sinh viên có điểm không
            var colIndexes = Object.keys(activityPoints);
            for (var c = 0; c < colIndexes.length; c++) {
              var colIdx = parseInt(colIndexes[c]);
              var cellValue = rowData[colIdx];
              var actInfo = activityPoints[colIdx];
              
              // Kiểm tra ô có điểm không (số hoặc chuỗi có thể parse thành số)
              var pointValue = parseCellValue(cellValue);
              if (pointValue === null || pointValue === 0) continue;
              
              // Xác định tên hoạt động
              var activityName;
              if (actInfo.isDynamic) {
                // Cột "Điểm" dynamic: tên hoạt động từ sheet/file
                activityName = sheetName.replace(/^[""]|[""]$/g, '');  // bỏ quotes nếu có
                if (!activityName || activityName.length < 2) {
                  activityName = file.getName();
                }
              } else {
                activityName = actInfo.name;
              }
              
              // Tạo bản ghi
              allRecords.push([
                mssv,
                hoTen,
                activityName,
                pointValue,
                actInfo.date || '',
                file.getName(),
                sheetName
              ]);
              recordsFromSheet++;
            }
          }
          
          if (recordsFromSheet > 0) {
            logMessages.push('      ✅ ' + recordsFromSheet + ' bản ghi từ sheet "' + sheetName + '"');
          }
        }
      } catch (fileErr) {
        logMessages.push('  ❌ Lỗi xử lý file ' + file.getName() + ': ' + fileErr.toString());
      }
    }
    
    // Bước 3: Ghi dữ liệu vào sheet Master
    var ss = getMasterSpreadsheet();
    var masterSheet = ss.getSheetByName('Master');
    
    if (!masterSheet) {
      masterSheet = ss.insertSheet('Master');
    }
    
    // Xóa dữ liệu cũ và ghi mới (trừ hàng tiêu đề)
    if (masterSheet.getLastRow() > 1) {
      masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 7).clearContent();
    }
    
    // Ghi tiêu đề nếu sheet trống
    var headerRow = ['MSSV', 'Họ tên', 'Tên hoạt động', 'Số điểm', 'Ngày thực hiện', 'File gốc', 'Sheet gốc'];
    masterSheet.getRange(1, 1, 1, headerRow.length).setValues([headerRow]);
    
    // Ghi dữ liệu một lần duy nhất
    if (allRecords.length > 0) {
      masterSheet.getRange(2, 1, allRecords.length, 7).setValues(allRecords);
      // Định dạng cột MSSV và Số điểm
      masterSheet.getRange(2, 1, allRecords.length, 1).setNumberFormat('@');  // Text
      masterSheet.getRange(2, 4, allRecords.length, 1).setNumberFormat('0.0#');
    }
    
    // Bước 4: Xóa cache cũ để lần gọi API tiếp theo lấy dữ liệu mới
    CacheService.getScriptCache().remove('master_cache');
    
    // Tính thời gian
    var endTime = new Date();
    var duration = ((endTime - startTime) / 1000).toFixed(1);
    
    logMessages.push('');
    logMessages.push('📊 TỔNG KẾT:');
    logMessages.push('   - File đã quét: ' + fileCount);
    logMessages.push('   - Tổng bản ghi: ' + allRecords.length);
    logMessages.push('   - Thời gian: ' + duration + ' giây');
    logMessages.push('✅ HOÀN THÀNH lúc: ' + endTime.toLocaleString('vi-VN'));
    
    // Ghi log
    writeLog(startTime, 'SUCCESS', fileCount, allRecords.length, duration + 's', logMessages.join('\n'));
    
  } catch (err) {
    logMessages.push('❌ LỖI NGHIÊM TRỌNG: ' + err.toString());
    logMessages.push('Stack: ' + (err.stack || 'N/A'));
    writeLog(startTime, 'ERROR', 0, 0, '0s', logMessages.join('\n'));
  }
}

/**
 * Tìm vị trí các cột quan trọng trong hàng tiêu đề.
 * Hỗ trợ nhiều cách đặt tên cột khác nhau (có thể khác giữa các file).
 * 
 * @param {Array} headers - Hàng tiêu đề của sheet
 * @return {Object} Map chứa index của các cột: mssvCol, nameCol, classCol
 */
function findColumnIndexes(headers) {
  var result = { mssvCol: -1, nameCol: -1, classCol: -1, dateCol: -1 };
  
  // Từ khóa để nhận diện cột (không phân biệt hoa/thường, có dấu/không dấu)
  var mssvKeywords = ['mssv', 'mã số', 'maso', 'mã sv', 'ma sv', 'student id', 'studentid'];
  var nameKeywords = ['họ tên', 'ho ten', 'họ và tên', 'ho va ten', 'tên', 'ten', 'full name', 'fullname', 'name'];
  var classKeywords = ['lớp', 'lop', 'class', 'lớp học', 'lop hoc'];
  var dateKeywords = ['ngày', 'ngay', 'date', 'thời gian', 'thoi gian', 'ngày thực hiện'];
  
  for (var i = 0; i < headers.length; i++) {
    var header = String(headers[i] || '').toLowerCase().trim();
    
    // Chuẩn hóa: bỏ dấu tiếng Việt để so sánh
    var normalized = removeVietnameseTones(header);
    
    // Kiểm tra MSSV
    if (result.mssvCol < 0) {
      for (var m = 0; m < mssvKeywords.length; m++) {
        if (normalized.indexOf(mssvKeywords[m]) >= 0) { result.mssvCol = i; break; }
      }
    }
    
    // Kiểm tra Họ tên
    if (result.nameCol < 0) {
      for (var n = 0; n < nameKeywords.length; n++) {
        if (normalized.indexOf(nameKeywords[n]) >= 0) { result.nameCol = i; break; }
      }
    }
    
    // Kiểm tra Lớp
    if (result.classCol < 0) {
      for (var c = 0; c < classKeywords.length; c++) {
        if (normalized.indexOf(classKeywords[c]) >= 0) { result.classCol = i; break; }
      }
    }
    
    // Kiểm tra Ngày
    if (result.dateCol < 0) {
      for (var d = 0; d < dateKeywords.length; d++) {
        if (normalized.indexOf(dateKeywords[d]) >= 0) { result.dateCol = i; break; }
      }
    }
  }
  
  return result;
}

/**
 * Trích xuất điểm từ hàng tiêu đề.
 * Quét tất cả cột tiêu đề, tìm những cột có chứa điểm số.
 * 
 * Pattern hỗ trợ:
 *   - "(+2)", "(+1.5)", "(+0.5)"
 *   - "2đ", "1.5 điểm", "2 diem"
 *   - "cộng 2đ", "cong 2 diem"
 *   - "+2", "+1.5"
 *   - "Hoạt động X (+2đ)"
 * 
 * @param {Array} headers - Hàng tiêu đề
 * @param {Object} colMap - Map vị trí cột đã biết
 * @return {Object} Map: { colIndex: { name: string, point: number, date: string } }
 */
function extractPointsFromHeaders(headers, colMap) {
  var result = {};
  
  // Regex để bắt điểm: tìm số (có thể có dấu + và thập phân) + đơn vị điểm
  // Pattern 1: (+2), (+1.5) - điểm trong ngoặc
  var patternParenthesis = /\(\+(\d+(?:\.\d+)?)\)/;
  
  // Pattern 2: +2đ, +1.5 điểm, 2đ, cộng 2 điểm...
  var patternPlusPoint = /\+?(\d+(?:\.\d+)?)\s*(?:đ|điểm|diem|d)/i;
  
  // Pattern 3: "Điểm", "Điểm số", "Điểm cộng" — cột chứa từ "điểm"
  var patternDiemColumn = /(?:điểm|diem|score|point)/i;
  
  for (var i = 0; i < headers.length; i++) {
    // Bỏ qua các cột đã biết (MSSV, Họ tên, Lớp, Ngày)
    if (i === colMap.mssvCol || i === colMap.nameCol || i === colMap.classCol) continue;
    
    var header = String(headers[i] || '').trim();
    if (!header) continue;
    
    var pointValue = null;
    var match;
    var isDiemColumn = false;
    
    // Thử pattern 1: điểm trong ngoặc (+X)
    match = header.match(patternParenthesis);
    if (match) {
      pointValue = parseFloat(match[1]);
    } else {
      // Thử pattern 2: +Xđ hoặc Xđ
      match = header.match(patternPlusPoint);
      if (match) {
        pointValue = parseFloat(match[1]);
      }
    }
    
    // Nếu tìm thấy điểm > 0, lưu lại
    if (pointValue !== null && pointValue > 0 && pointValue <= 20) {
      // Làm sạch tên hoạt động: bỏ điểm khỏi tiêu đề
      var activityName = header
        .replace(patternParenthesis, '')
        .replace(patternPlusPoint, '')
        .replace(/[\(\)]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Nếu sau khi làm sạch mà rỗng, dùng chính tiêu đề gốc
      if (!activityName) activityName = header;
      
      result[i] = {
        name: activityName,
        point: pointValue
      };
      continue;
    }
    
    // Pattern 3: Cột tên "Điểm", "Điểm số" — đánh dấu để xử lý sau
    // Điểm sẽ được đọc từ giá trị ô, tên hoạt động từ tên sheet/file
    if (!pointValue && patternDiemColumn.test(header)) {
      result[i] = {
        name: '__DIEM_COLUMN__',  // placeholder, sẽ thay bằng tên sheet
        point: 0,                  // sẽ đọc từ giá trị ô
        isDynamic: true
      };
    }
  }
  
  return result;
}

/**
 * Parse giá trị ô dữ liệu thành số điểm.
 * Hỗ trợ cả số và chuỗi (ví dụ: "2", 2, "Tham gia" → null)
 * 
 * @param {*} value - Giá trị ô
 * @return {number|null} Số điểm hoặc null nếu không phải điểm
 */
function parseCellValue(value) {
  if (value === null || value === undefined || value === '') return null;
  
  // Nếu là số
  if (typeof value === 'number') {
    return (value > 0 && value <= 20) ? value : null;
  }
  
  // Nếu là chuỗi
  var strValue = String(value).trim();
  
  // Thử parse trực tiếp
  var numValue = parseFloat(strValue);
  if (!isNaN(numValue) && numValue > 0 && numValue <= 20) {
    return numValue;
  }
  
  // Thử regex cho các pattern như "x", "đã tham gia", "✓", "✔" → không parse được
  // Trả về null cho các giá trị không phải số
  
  return null;
}

/**
 * Loại bỏ dấu tiếng Việt khỏi chuỗi (để so sánh không phân biệt dấu).
 */
function removeVietnameseTones(str) {
  str = str.replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a');
  str = str.replace(/[èéẹẻẽêềếệểễ]/g, 'e');
  str = str.replace(/[ìíịỉĩ]/g, 'i');
  str = str.replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o');
  str = str.replace(/[ùúụủũưừứựửữ]/g, 'u');
  str = str.replace(/[ỳýỵỷỹ]/g, 'y');
  str = str.replace(/đ/g, 'd');
  return str;
}

/**
 * Ghi log vào sheet "Log".
 */
function writeLog(startTime, status, fileCount, recordCount, duration, detail) {
  try {
    var ss = getMasterSpreadsheet();
    var logSheet = ss.getSheetByName('Log');
    
    if (!logSheet) {
      logSheet = ss.insertSheet('Log');
      logSheet.getRange(1, 1, 1, 6).setValues([['Thời gian', 'Trạng thái', 'Số file', 'Số bản ghi', 'Thời gian chạy', 'Chi tiết']]);
    }
    
    // Giới hạn log ở 500 dòng gần nhất
    var maxLogRows = 500;
    if (logSheet.getLastRow() > maxLogRows) {
      logSheet.deleteRows(2, logSheet.getLastRow() - maxLogRows);
    }
    
    logSheet.insertRowAfter(1);
    logSheet.getRange(2, 1, 1, 6).setValues([[
      startTime.toLocaleString('vi-VN'),
      status,
      fileCount,
      recordCount,
      duration,
      detail
    ]]);
    
    // Định dạng
    logSheet.getRange(2, 1, 1, 6).setFontSize(10);
    if (status === 'ERROR') {
      logSheet.getRange(2, 1, 1, 6).setBackground('#FFE0E0');
    }
  } catch (e) {
    // Không thể ghi log → ít nhất log ra console
    console.error('Lỗi ghi log: ' + e.toString());
  }
}

/**
 * Hàm chạy thủ công để test ETL pipeline.
 * Chạy từ trình chỉnh sửa Apps Script: chọn hàm này → Run.
 */
function testETL() {
  Logger.log('=== TEST ETL PIPELINE ===');
  updateMasterDCT1253();
  Logger.log('=== KẾT THÚC TEST ===');
}

// ═══════════════════════════════════════════════════════════════════════════
// PHẦN 2: BACKEND API (Web App)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hàm xử lý HTTP GET request.
 * Deploy as Web App → lấy URL → dùng làm API endpoint.
 * 
 * Endpoints:
 *   ?mssv=225xxxx          → Tra cứu điểm 1 sinh viên (public)
 *   ?action=stats          → Thống kê nhanh
 *   ?action=health         → Health check
 * 
 * @param {Object} e - Event object chứa tham số query
 * @return {ContentService} JSON response
 */
function doGet(e) {
  // Thiết lập CORS headers (cho phép frontend gọi API từ GitHub Pages)
  var output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  
  try {
    var params = e && e.parameter ? e.parameter : {};
    var mssv = (params.mssv || '').trim();
    var action = (params.action || '').trim().toLowerCase();
    
    // ── Endpoint: Tra cứu điểm theo MSSV ──
    if (mssv) {
      return respondJSON(queryMSSV(mssv));
    }
    
    // ── Endpoint: Thống kê ──
    if (action === 'stats') {
      return respondJSON(getStats());
    }
    
    // ── Endpoint: Health check ──
    if (action === 'health') {
      return respondJSON({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        class: CONFIG.TARGET_CLASS
      });
    }
    
    // ── Mặc định: Hướng dẫn sử dụng ──
    return respondJSON({
      status: 'ok',
      message: 'API Tra cứu Điểm Hoạt động DCT1253',
      usage: {
        lookup: '?mssv=225xxxx',
        stats: '?action=stats',
        health: '?action=health'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (err) {
    return respondJSON({
      status: 'error',
      message: 'Lỗi hệ thống: ' + err.toString()
    });
  }
}

/**
 * Tra cứu điểm của một sinh viên theo MSSV.
 * Sử dụng cache 6 tiếng để tối ưu performance.
 * 
 * @param {string} mssv - Mã số sinh viên
 * @return {Object} Kết quả tra cứu
 */
function queryMSSV(mssv) {
  // Validate MSSV format (chỉ chấp nhận số, 6-10 ký tự)
  var mssvPattern = /^\d{6,10}$/;
  if (!mssvPattern.test(mssv)) {
    return {
      status: 'error',
      message: 'MSSV không hợp lệ. Vui lòng nhập mã số sinh viên (6-10 chữ số).'
    };
  }
  
  // Kiểm tra cache
  var cache = CacheService.getScriptCache();
  var cacheKey = 'mssv_' + mssv;
  var cached = cache.get(cacheKey);
  
  if (cached) {
    var result = JSON.parse(cached);
    result._cached = true;
    result._cache_age = 'tối đa ' + (CONFIG.CACHE_DURATION / 3600) + ' giờ';
    return result;
  }
  
  // Đọc dữ liệu từ Master sheet
  var allData = loadMasterData();
  
  if (!allData || allData.length === 0) {
    return {
      status: 'error',
      message: 'Chưa có dữ liệu. Vui lòng thử lại sau.'
    };
  }
  
  // Lọc theo MSSV
  var studentRecords = [];
  var hoTen = '';
  
  for (var i = 0; i < allData.length; i++) {
    if (String(allData[i][0]).trim() === mssv) {
      studentRecords.push({
        ten_hoat_dong: allData[i][2] || 'Không rõ',
        so_diem: parseFloat(allData[i][3]) || 0,
        ngay: allData[i][4] || 'Không rõ',
        file_goc: allData[i][5] || '',
        sheet_goc: allData[i][6] || ''
      });
      if (!hoTen) hoTen = allData[i][1];
    }
  }
  
  // Nếu không tìm thấy sinh viên
  if (studentRecords.length === 0) {
    var result = {
      status: 'not_found',
      message: 'Không tìm thấy sinh viên với MSSV ' + mssv + ' trong lớp ' + CONFIG.TARGET_CLASS + '.',
      mssv: mssv
    };
    return result;
  }
  
  // Tính tổng điểm
  var tongDiem = 0;
  for (var j = 0; j < studentRecords.length; j++) {
    tongDiem += studentRecords[j].so_diem;
  }
  
  // Sắp xếp chi tiết theo điểm giảm dần
  studentRecords.sort(function(a, b) {
    return b.so_diem - a.so_diem;
  });
  
  var result = {
    status: 'ok',
    mssv: mssv,
    ho_ten: hoTen,
    tong_diem: Math.round(tongDiem * 10) / 10,  // Làm tròn 1 chữ số thập phân
    so_hoat_dong: studentRecords.length,
    chi_tiet: studentRecords,
    cap_nhat_luc: getLastUpdateTime()
  };
  
  // Lưu cache
  try {
    cache.put(cacheKey, JSON.stringify(result), CONFIG.CACHE_DURATION);
  } catch (cacheErr) {
    // Cache có thể fail nếu dữ liệu quá lớn → bỏ qua
    console.warn('Không thể cache cho MSSV ' + mssv + ': ' + cacheErr);
  }
  
  return result;
}

/**
 * Đọc toàn bộ dữ liệu từ sheet Master.
 * Có cache riêng cho toàn bộ dữ liệu (dùng chung cho nhiều request).
 * 
 * @return {Array} Mảng 2 chiều chứa dữ liệu
 */
function loadMasterData() {
  var cache = CacheService.getScriptCache();
  var masterCacheKey = 'master_data';
  var cached = cache.get(masterCacheKey);
  
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (e) {
      // Cache hỏng → đọc lại
      cache.remove(masterCacheKey);
    }
  }
  
  var ss = getMasterSpreadsheet();
  var masterSheet = ss.getSheetByName('Master');
  
  if (!masterSheet || masterSheet.getLastRow() < 2) {
    return [];
  }
  
  var data = masterSheet.getRange(2, 1, masterSheet.getLastRow() - 1, 7).getValues();
  
  // Cache dữ liệu (giới hạn để tránh vượt quá 100KB cache limit của Apps Script)
  try {
    // Chỉ cache tối đa 5000 dòng để đảm bảo không vượt quá giới hạn
    var dataToCache = data.length > 5000 ? data.slice(0, 5000) : data;
    cache.put(masterCacheKey, JSON.stringify(dataToCache), CONFIG.CACHE_DURATION);
  } catch (e) {
    console.warn('Không thể cache master data: ' + e);
  }
  
  return data;
}

/**
 * Lấy thời gian cập nhật dữ liệu lần cuối (từ sheet Log).
 * 
 * @return {string} Thời gian dạng ISO
 */
function getLastUpdateTime() {
  try {
    var ss = getMasterSpreadsheet();
    var logSheet = ss.getSheetByName('Log');
    if (logSheet && logSheet.getLastRow() >= 2) {
      var lastLog = logSheet.getRange(2, 1).getValue();
      return lastLog || 'Chưa có dữ liệu';
    }
  } catch (e) {
    // Bỏ qua
  }
  return 'Chưa có dữ liệu';
}

/**
 * Thống kê tổng quan.
 * 
 * @return {Object} Dữ liệu thống kê
 */
function getStats() {
  var cache = CacheService.getScriptCache();
  var statsKey = 'stats_data';
  var cached = cache.get(statsKey);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  var allData = loadMasterData();
  
  if (!allData || allData.length === 0) {
    return { status: 'error', message: 'Chưa có dữ liệu' };
  }
  
  // Đếm số sinh viên unique
  var studentSet = {};
  var studentScores = {};  // { mssv: totalScore }
  var activityCount = {};  // { activityName: count }
  
  for (var i = 0; i < allData.length; i++) {
    var mssv = String(allData[i][0]).trim();
    var score = parseFloat(allData[i][3]) || 0;
    var activity = allData[i][2] || 'Không rõ';
    
    studentSet[mssv] = true;
    
    if (!studentScores[mssv]) studentScores[mssv] = 0;
    studentScores[mssv] += score;
    
    if (!activityCount[activity]) activityCount[activity] = 0;
    activityCount[activity]++;
  }
  
  // Top 10 sinh viên
  var topStudents = Object.keys(studentScores)
    .map(function(k) { return { mssv: k, tong_diem: Math.round(studentScores[k] * 10) / 10 }; })
    .sort(function(a, b) { return b.tong_diem - a.tong_diem; })
    .slice(0, 10);
  
  // Top hoạt động
  var topActivities = Object.keys(activityCount)
    .map(function(k) { return { ten: k, so_luong: activityCount[k] }; })
    .sort(function(a, b) { return b.so_luong - a.so_luong; })
    .slice(0, 10);
  
  var stats = {
    status: 'ok',
    tong_sinh_vien: Object.keys(studentSet).length,
    tong_ban_ghi: allData.length,
    tong_diem_toan_lop: Math.round(Object.values(studentScores).reduce(function(a, b) { return a + b; }, 0) * 10) / 10,
    diem_trung_binh: Math.round((Object.values(studentScores).reduce(function(a, b) { return a + b; }, 0) / Object.keys(studentSet).length) * 100) / 100,
    top_sinh_vien: topStudents,
    top_hoat_dong: topActivities,
    cap_nhat_luc: getLastUpdateTime()
  };
  
  try {
    cache.put(statsKey, JSON.stringify(stats), 3600); // Cache 1 giờ
  } catch (e) {}
  
  return stats;
}

/**
 * Helper: Tạo HTTP response JSON với CORS headers.
 */
function respondJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Helper: Lấy URL của Web App hiện tại (dùng để hiển thị trong log).
 */
function getWebAppUrl() {
  try {
    return ScriptApp.getService().getUrl();
  } catch (e) {
    return 'Chưa deploy Web App';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PHẦN 3: SETUP TRIGGER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cài đặt trigger tự động chạy hàng ngày lúc 2:00 AM.
 * Chạy hàm này MỘT LẦN từ trình chỉnh sửa Apps Script để cài trigger.
 */
function setupDailyTrigger() {
  // Xóa trigger cũ (tránh trùng lặp)
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'updateMasterDCT1253') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // Tạo trigger mới: chạy lúc 2:00 - 3:00 AM mỗi ngày
  ScriptApp.newTrigger('updateMasterDCT1253')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  
  Logger.log('✅ Đã cài đặt trigger: chạy updateMasterDCT1253() lúc 2:00 AM hàng ngày');
}

/**
 * Xem danh sách trigger hiện tại.
 */
function listTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  var result = [];
  for (var i = 0; i < triggers.length; i++) {
    var t = triggers[i];
    result.push({
      handler: t.getHandlerFunction(),
      type: t.getEventType(),
      source: t.getTriggerSource(),
      id: t.getUniqueId()
    });
  }
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/**
 * Xóa tất cả trigger.
 */
function clearAllTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
  Logger.log('✅ Đã xóa tất cả trigger (' + triggers.length + ' trigger)');
}
