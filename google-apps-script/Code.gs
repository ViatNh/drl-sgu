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
  DRIVE_FOLDER_ID: '1TOgKamuzGi0EwYSdq3U5L8yhts0SWJHB',
  MASTER_SHEET_ID: '1-ei7QpPzvKvCXNh4zgbRv_Dk60Gr6LmBqxwyOSpsHuU',
  CACHE_DURATION: 21600,
  TARGET_CLASS: 'DCT1253',
};

// Force Apps Script nhận diện scope Drive (cho phép convert Excel)
var _driveApiCheck = (typeof Drive !== 'undefined') ? Drive.Files : UrlFetchApp;

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
    
    // Bước 2: Duyệt TẤT CẢ file (cả Google Sheets và Excel)
    var allFiles = [];
    var fileTypes = {};
    
    // Gộp tất cả loại file
    var gsheetFiles = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (gsheetFiles.hasNext()) { allFiles.push(gsheetFiles.next()); }
    fileTypes['Google Sheets'] = allFiles.length;
    
    var xlsxFiles = folder.getFilesByType(MimeType.MICROSOFT_EXCEL);
    var xlsCount = 0;
    while (xlsxFiles.hasNext()) { allFiles.push(xlsxFiles.next()); xlsCount++; }
    fileTypes['Excel (.xlsx)'] = xlsCount;
    
    var xlsLegacyFiles = folder.getFilesByType(MimeType.MICROSOFT_EXCEL_LEGACY);
    var xlsLegacyCount = 0;
    while (xlsLegacyFiles.hasNext()) { allFiles.push(xlsLegacyFiles.next()); xlsLegacyCount++; }
    fileTypes['Excel (.xls)'] = xlsLegacyCount;
    
    logMessages.push('📊 Tổng file: ' + allFiles.length + ' (' + JSON.stringify(fileTypes) + ')');
    
    var allRecords = [];
    var fileCount = 0;
    var skippedCount = 0;
    var excelSkippedCount = 0;
    
    for (var f = 0; f < allFiles.length; f++) {
      var file = allFiles[f];
      fileCount++;
      
      var mimeType = file.getMimeType();
      var isGoogleSheet = (mimeType === MimeType.GOOGLE_SHEETS);
      
      if (!isGoogleSheet) {
        // Thử convert Excel → Google Sheets
        try {
          var convertedId = convertExcelToGoogleSheet(file, logMessages);
          if (convertedId) {
            spreadsheet = SpreadsheetApp.openById(convertedId);
            logMessages.push('  🔄 [' + fileCount + '] ' + file.getName() + ' → đã convert sang Google Sheets');
            // Tiếp tục xử lý như Google Sheets bình thường (xuống dưới)
          } else {
            excelSkippedCount++;
            continue;
          }
        } catch (convErr) {
          excelSkippedCount++;
          if (excelSkippedCount <= 3) {
            logMessages.push('  ⚠️ File Excel (không convert được): ' + file.getName() + ' - ' + convErr.toString());
          }
          continue;
        }
      } else {
        spreadsheet = SpreadsheetApp.openById(file.getId());
      }
      
      try {
        var sheets = spreadsheet.getSheets();
        
        logMessages.push('  📄 [' + fileCount + '] ' + file.getName() + ' (' + sheets.length + ' sheet)');
        
        for (var s = 0; s < sheets.length; s++) {
          var sheet = sheets[s];
          var sheetName = sheet.getName();
          
          var lastRow = sheet.getLastRow();
          if (lastRow < 2) {
            logMessages.push('      ⏭️ Sheet "' + sheetName + '" rỗng, bỏ qua');
            continue;
          }
          
          // Đọc toàn bộ dữ liệu
          var data = sheet.getDataRange().getValues();
          if (data.length < 2) continue;
          
          // ============================================================
          // PARSER MỚI: Quét từng dòng tìm hoạt động (+X) + bảng con
          // ============================================================
          var recordsFromSheet = 0;
          var currentActivity = null;  // { name, point }
          
          for (var row = 0; row < data.length; row++) {
            var rowData = data[row];
            
            // Bước 1: Quét tất cả ô trong dòng để tìm pattern (+X) hoặc +Xđ
            var foundActivity = null;
            for (var col = 0; col < rowData.length; col++) {
              var cellStr = String(rowData[col] || '').trim();
              if (!cellStr) continue;
              
              // Pattern: (+2), (+1.5), +2đ, +5 điểm
              var match = cellStr.match(/\(\+(\d+(?:\.\d+)?)\)/) || cellStr.match(/\+(\d+(?:\.\d+)?)\s*[đd]?/);
              if (match) {
                var pts = parseFloat(match[1]);
                if (pts > 0 && pts <= 50) {
                  // Làm sạch tên hoạt động
                  var actName = cellStr
                    .replace(/\(\+\d+(?:\.\d+)?\)/g, '')
                    .replace(/\+\d+(?:\.\d+)?\s*[đdđiểm]*/gi, '')
                    .replace(/^-{3,}/, '')  // bỏ dòng gạch ngang
                    .replace(/\s+/g, ' ')
                    .trim();
                  
                  // Bỏ qua dòng chỉ là số mục (VD: "III.2.")
                  if (actName.length < 10) continue;
                  
                  foundActivity = { name: actName, point: pts };
                  break;
                }
              }
            }
            
            if (foundActivity) {
              currentActivity = foundActivity;
              logMessages.push('      🏷️ Hoạt động: "' + currentActivity.name.substring(0, 60) + '" (+' + currentActivity.point + 'đ)');
              continue;
            }
            
            // Bước 2: Nếu đang trong 1 hoạt động, tìm dòng sinh viên
            if (currentActivity) {
              // Dòng sinh viên: ô đầu là STT (số), ô thứ 2 là MSSV (số 6-10 chữ số)
              var cell0 = String(rowData[0] || '').trim();
              var cell1 = String(rowData[1] || '').trim();
              
              // STT phải là số nguyên dương
              var stt = parseInt(cell0);
              if (isNaN(stt) || stt <= 0) continue;
              
              // MSSV phải là chuỗi số 6-10 ký tự
              if (!/^\d{6,10}$/.test(cell1)) continue;
              
              var mssv = cell1;
              
              // Tìm LỚP: cột chứa "DCT"
              var lop = '';
              var hoLot = '';
              var ten = '';
              
              // Cấu trúc cột dựa trên format anh gửi:
              // STT | MSSV | HỌ LÓT | TÊN | LỚP | KHOA
              //  0  |  1   |   2    |  3  |  4  |  5
              hoLot = String(rowData[2] || '').trim();
              ten = String(rowData[3] || '').trim();
              lop = String(rowData[4] || '').trim().toUpperCase();
              
              // Fallback: quét tất cả cột tìm cột chứa "DCT" nếu col 4 không phải
              if (lop.indexOf('DCT') < 0) {
                for (var cc = 0; cc < rowData.length; cc++) {
                  var cellVal = String(rowData[cc] || '').trim().toUpperCase();
                  if (cellVal.indexOf('DCT') >= 0) {
                    lop = cellVal;
                    break;
                  }
                }
              }
              
              // Chỉ giữ sinh viên DCT1253
              if (lop !== CONFIG.TARGET_CLASS) continue;
              
              var hoTen = (hoLot + ' ' + ten).trim();
              if (!hoTen || hoTen.length < 3) continue;
              
              // Tạo bản ghi
              allRecords.push([
                mssv,
                hoTen,
                currentActivity.name,
                currentActivity.point,
                '',                       // ngày (không có trong format này)
                file.getName(),
                sheetName
              ]);
              recordsFromSheet++;
            }
          }
          
          if (recordsFromSheet > 0) {
            logMessages.push('      ✅ ' + recordsFromSheet + ' bản ghi từ sheet "' + sheetName + '"');
          } else {
            logMessages.push('      ℹ️ Sheet "' + sheetName + '" không có dữ liệu DCT1253');
          }
        }
      } catch (fileErr) {
        logMessages.push('  ❌ Lỗi xử lý file ' + file.getName() + ': ' + fileErr.toString());
      }
    }
    
    if (excelSkippedCount > 0) {
      logMessages.push('⚠️ ' + excelSkippedCount + ' file Excel bị bỏ qua (cần convert sang Google Sheets)');
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
    var gsheetCount = fileCount - excelSkippedCount;
    logMessages.push('   - File đã quét: ' + gsheetCount + ' Google Sheets' + (excelSkippedCount > 0 ? ' (' + excelSkippedCount + ' Excel bị bỏ qua)' : ''));
    logMessages.push('   - Tổng bản ghi: ' + allRecords.length);
    logMessages.push('   - Thời gian: ' + duration + ' giây');
    logMessages.push('✅ HOÀN THÀNH lúc: ' + endTime.toLocaleString('vi-VN'));
    
    // Ghi log
    writeLog(startTime, 'SUCCESS', gsheetCount, allRecords.length, duration + 's', logMessages.join('\n'));
    
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
 * Convert file Excel (.xlsx/.xls) sang Google Sheets.
 * Sử dụng Advanced Drive Service (cần bật trong Resources → Advanced Google Services).
 * Nếu không bật Drive API, hàm sẽ trả về null và file Excel sẽ bị bỏ qua.
 * 
 * @param {File} file - File Excel từ DriveApp
 * @return {string|null} ID của Google Sheet đã convert, hoặc null nếu thất bại
 */
function convertExcelToGoogleSheet(file, logMessages) {
  var blob = file.getBlob();
  var fileName = file.getName();
  
  // Cách 1: Dùng Drive API v3 (Drive.Files.create)
  try {
    if (typeof Drive !== 'undefined' && Drive.Files) {
      var resource = {
        name: fileName + ' (converted)',
        mimeType: MimeType.GOOGLE_SHEETS
        // KHÔNG set parents — lưu vào root Drive của anh (có quyền ghi)
      };
      var converted = Drive.Files.create(resource, blob, { convert: true });
      logMessages.push('      🔧 Convert OK (Drive v3): ' + fileName);
      return converted.id;
    }
  } catch (e) {
    // Thử v2 syntax
    try {
      var resourceV2 = {
        title: fileName + ' (converted)',
        mimeType: MimeType.GOOGLE_SHEETS
      };
      var convertedV2 = Drive.Files.insert(resourceV2, blob, { convert: true });
      logMessages.push('      🔧 Convert OK (Drive v2): ' + fileName);
      return convertedV2.id;
    } catch (e2) {
      logMessages.push('      🔧 Drive API failed: ' + e.toString().substring(0, 80));
    }
  }
  
  // Cách 2: Dùng UrlFetchApp gọi REST API (lưu vào root Drive)
  try {
    var token = ScriptApp.getOAuthToken();
    var metadata = {
      name: fileName + ' (converted)',
      mimeType: MimeType.GOOGLE_SHEETS
      // KHÔNG set parents
    };
    
    var boundary = 'hermes_b_' + Math.random().toString(36).slice(2);
    var requestBody = '';
    requestBody += '--' + boundary + '\r\n';
    requestBody += 'Content-Type: application/json; charset=UTF-8\r\n\r\n';
    requestBody += JSON.stringify(metadata) + '\r\n';
    requestBody += '--' + boundary + '\r\n';
    requestBody += 'Content-Type: ' + blob.getContentType() + '\r\n';
    requestBody += 'Content-Transfer-Encoding: base64\r\n\r\n';
    requestBody += Utilities.base64Encode(blob.getBytes()) + '\r\n';
    requestBody += '--' + boundary + '--';
    
    var resp = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&convert=true',
      {
        method: 'POST',
        contentType: 'multipart/related; boundary=' + boundary,
        headers: { Authorization: 'Bearer ' + token },
        payload: requestBody,
        muteHttpExceptions: true
      }
    );
    
    if (resp.getResponseCode() === 200) {
      var result = JSON.parse(resp.getContentText());
      logMessages.push('      🔧 Convert OK (REST): ' + fileName);
      return result.id;
    } else {
      logMessages.push('      🔧 REST HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText().substring(0, 100));
    }
  } catch (e2) {
    logMessages.push('      🔧 REST error: ' + e2.toString().substring(0, 80));
  }
  
  return null;
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
  return handleRequest(e);
}

/**
 * Xử lý cả GET và POST request (POST cũng gọi hàm này).
 */
function doPost(e) {
  return handleRequest(e);
}

/**
 * Hàm xử lý request chính.
 * Đảm bảo luôn trả về JSON với CORS headers.
 */
function handleRequest(e) {
  var responseData;
  
  try {
    var params = e && e.parameter ? e.parameter : {};
    var mssv = (params.mssv || '').trim();
    var action = (params.action || '').trim().toLowerCase();
    
    // ── Endpoint: Tra cứu điểm theo MSSV ──
    if (mssv) {
      responseData = queryMSSV(mssv);
    }
    // ── Endpoint: Thống kê ──
    else if (action === 'stats') {
      responseData = getStats();
    }
    // ── Endpoint: Health check ──
    else if (action === 'health') {
      responseData = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        class: CONFIG.TARGET_CLASS
      };
    }
    // ── Mặc định: Hướng dẫn sử dụng ──
    else {
      responseData = {
        status: 'ok',
        message: 'API Tra cứu Điểm Hoạt động DCT1253',
        usage: {
          lookup: '?mssv=225xxxx',
          stats: '?action=stats',
          health: '?action=health'
        },
        timestamp: new Date().toISOString()
      };
    }
  } catch (err) {
    responseData = {
      status: 'error',
      message: 'Lỗi hệ thống: ' + err.toString()
    };
  }
  
  return ContentService.createTextOutput(JSON.stringify(responseData, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
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
