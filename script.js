/**
 * ============================================================================
 * TRA CỨU ĐIỂM HOẠT ĐỘNG DCT1253 - Frontend JavaScript
 * ============================================================================
 * File: script.js
 * Mô tả: Xử lý toàn bộ logic frontend: gọi API, hiển thị kết quả,
 *        lịch sử MSSV, sort, chia sẻ.
 * ============================================================================
 */

// ═══════════════════════════════════════════════════════════════════════════
// CẤU HÌNH - THAY ĐỔI URL API TẠI ĐÂY SAU KHI DEPLOY WEB APP
// ═══════════════════════════════════════════════════════════════════════════
const CONFIG = {
  API_BASE_URL: 'https://script.google.com/macros/s/AKfycbyBs9F7fnT9sN8khpFaxMhVR0FUBmPvBplU8a8yXWka2UkkAUSk-7IzZ6UypiNNPDx7eA/exec',
  
  MAX_RECENT_MSSV: 5,
  RECENT_STORAGE_KEY: 'dct1253_recent_mssv',
};

// ═══════════════════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════════════════
const DOM = {
  mssvInput: document.getElementById('mssvInput'),
  classSelect: document.getElementById('classSelect'),
  searchBtn: document.getElementById('searchBtn'),
  searchBtnText: document.getElementById('searchBtnText'),
  searchSpinner: document.getElementById('searchSpinner'),
  clearBtn: document.getElementById('clearBtn'),
  recentMssv: document.getElementById('recentMssv'),
  recentTags: document.getElementById('recentTags'),
  
  loadingCard: document.getElementById('loadingCard'),
  errorCard: document.getElementById('errorCard'),
  errorTitle: document.getElementById('errorTitle'),
  errorMessage: document.getElementById('errorMessage'),
  emptyCard: document.getElementById('emptyCard'),
  resultCard: document.getElementById('resultCard'),
  
  totalScore: document.getElementById('totalScore'),
  studentName: document.getElementById('studentName'),
  studentMssv: document.getElementById('studentMssv'),
  activityCount: document.getElementById('activityCount'),
  lastUpdate: document.getElementById('lastUpdate'),
  detailBody: document.getElementById('detailBody'),
  
  shareBtn: document.getElementById('shareBtn'),
  newSearchBtn: document.getElementById('newSearchBtn'),
  
  footerUpdateTime: document.getElementById('footerUpdateTime'),
};

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
let isLoading = false;
let currentResult = null;
let currentSort = { field: null, asc: true };

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  renderRecentMSSV();
  showEmptyState();
  loadClasses();
  checkAPIHealth();
});

/**
 * Khởi tạo tất cả event listeners.
 */
function initEventListeners() {
  // Nút tìm kiếm
  DOM.searchBtn.addEventListener('click', handleSearch);
  
  // Enter key trong input
  DOM.mssvInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !isLoading) {
      handleSearch();
    }
  });
  
  // Tự động lọc chỉ nhận số
  DOM.mssvInput.addEventListener('input', (e) => {
    // Chỉ giữ lại chữ số
    const filtered = e.target.value.replace(/[^0-9]/g, '');
    if (filtered !== e.target.value) {
      e.target.value = filtered;
    }
    
    // Hiển thị/ẩn nút clear
    DOM.clearBtn.classList.toggle('hidden', !filtered);
  });
  
  // Nút clear
  DOM.clearBtn.addEventListener('click', () => {
    DOM.mssvInput.value = '';
    DOM.clearBtn.classList.add('hidden');
    DOM.mssvInput.focus();
    showEmptyState();
  });
  
  // Nút chia sẻ
  DOM.shareBtn.addEventListener('click', handleShare);
  
  // Nút cập nhật cache (thay thế "Tra cứu mới")
  DOM.newSearchBtn.addEventListener('click', handleRefreshCache);
  
  // Sort table headers
  document.querySelectorAll('#detailTable th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.getAttribute('data-sort');
      handleSort(field);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// API CALLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Gọi API bằng JSONP — bypass CORS.
 * Dùng <script> tag thay vì fetch() để tránh lỗi CORS.
 * 
 * @param {Object} params - Tham số query (VD: {mssv: '225...', action: 'health'})
 * @return {Promise<Object>} Kết quả từ API
 */
function jsonpAPI(params) {
  return new Promise((resolve, reject) => {
    const callbackName = 'dct1253_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    
    // Build URL
    const queryParts = [];
    for (const [key, val] of Object.entries(params)) {
      queryParts.push(encodeURIComponent(key) + '=' + encodeURIComponent(val));
    }
    queryParts.push('callback=' + callbackName);
    const url = CONFIG.API_BASE_URL + '?' + queryParts.join('&');
    
    // Timeout sau 10 giây
    const timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Yêu cầu quá thời gian chờ. Vui lòng thử lại.'));
    }, 10000);
    
    // Đăng ký callback global
    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };
    
    // Tạo <script> tag
    const script = document.createElement('script');
    script.src = url;
    script.onerror = () => {
      cleanup();
      reject(new Error('Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng.'));
    };
    
    function cleanup() {
      clearTimeout(timeoutId);
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }
    
    document.body.appendChild(script);
  });
}

/**
 * Tra cứu điểm sinh viên qua API.
 */
async function fetchStudentScore(mssv) {
  return jsonpAPI({ mssv });
}

/**
 * Health check API.
 */
async function checkAPIHealth() {
  try {
    const data = await jsonpAPI({ action: 'health' });
    
    if (data.status === 'ok') {
      console.log('✅ API connected:', data);
      if (data.timestamp) {
        DOM.footerUpdateTime.textContent = 'Máy chủ hoạt động';
      }
    }
  } catch (err) {
    console.warn('⚠️ API health check failed:', err.message);
    DOM.footerUpdateTime.textContent = 'Không kết nối được máy chủ';
  }
}

/**
 * Load danh sách lớp từ API và hiển thị dropdown nếu có nhiều lớp.
 */
async function loadClasses() {
  try {
    const data = await jsonpAPI({ action: 'classes' });
    if (data.classes && data.classes.length >= 1) {
      // Luôn hiện dropdown (kể cả 1 lớp để quen UI)
      DOM.classSelect.classList.remove('hidden');
      DOM.classSelect.innerHTML = data.classes.map(c => 
        `<option value="${c}" ${c === data.default ? 'selected' : ''}>${c}</option>`
      ).join('');
    }
  } catch (e) {
    // Nếu không load được classes → để CONFIG.DEFAULT_CLASS làm fallback
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Xử lý tìm kiếm.
 */
async function handleSearch() {
  if (isLoading) return;
  
  const mssv = DOM.mssvInput.value.replace(/[^0-9]/g, '').trim();
  
  // Validate
  if (!mssv || mssv.length !== 10) {
    showError('MSSV không hợp lệ', 'Vui lòng nhập đúng 10 chữ số.');
    DOM.mssvInput.focus();
    return;
  }
  
  // Bắt đầu loading
  setLoading(true);
  hideAllCards();
  DOM.loadingCard.classList.remove('hidden');
  
  try {
    const data = await fetchStudentScore(mssv);
    
    // Xử lý response
    if (data.status === 'ok') {
      currentResult = data;
      saveRecentMSSV(mssv);
      renderResult(data);
      DOM.resultCard.classList.remove('hidden');
      
      // Scroll đến kết quả
      DOM.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (data.status === 'not_found') {
      showError('Không tìm thấy', data.message || `Không tìm thấy sinh viên với MSSV ${mssv}.`);
    } else {
      showError('Lỗi', data.message || 'Đã xảy ra lỗi không xác định.');
    }
  } catch (err) {
    showError('Lỗi kết nối', err.message);
  } finally {
    setLoading(false);
    DOM.loadingCard.classList.add('hidden');
    
    // Cập nhật giao diện input
    DOM.mssvInput.value = mssv;
    DOM.clearBtn.classList.toggle('hidden', !mssv);
  }
}

/**
 * Xử lý chia sẻ kết quả.
 */
async function handleShare() {
  if (!currentResult) return;
  
  const shareBtn = DOM.shareBtn;
  const originalHTML = shareBtn.innerHTML;
  shareBtn.innerHTML = '⏳ Đang chụp...';
  shareBtn.disabled = true;
  
  try {
    // Chỉ chụp vùng bảng kết quả (không bao gồm nút Chia sẻ / Cập nhật)
    const captureArea = document.getElementById('shareCaptureArea');
    const canvas = await html2canvas(captureArea, {
      backgroundColor: null,  // Trong suốt — tránh overlay trắng đục
      scale: 2,               // Độ phân giải cao
      useCORS: true,
      logging: false,
      allowTaint: true,       // Cho phép render gradient từ CSS
    });
    
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const file = new File([blob], `DCT1253_${currentResult.mssv}.png`, { type: 'image/png' });
    
    const shareData = {
      title: `Điểm hoạt động - ${currentResult.ho_ten}`,
      text: `${currentResult.ho_ten} (${currentResult.mssv}): ${currentResult.tong_diem} điểm`,
      files: [file],
    };
    
    // Web Share API với file (mobile)
    if (navigator.canShare && navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return;
    }
    
    // Fallback: tải ảnh về máy
    const link = document.createElement('a');
    link.download = `DCT1253_${currentResult.mssv}.png`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('📸 Đã tải ảnh kết quả!');
    
  } catch (err) {
    if (err.name !== 'AbortError') {
      // Fallback text nếu html2canvas lỗi
      const shareText = [
        `🎓 ${currentResult.ho_ten} (${currentResult.mssv})`,
        `🏆 Tổng: ${currentResult.tong_diem} điểm | ${currentResult.so_hoat_dong} hoạt động`,
        `🔗 ${window.location.href}?mssv=${currentResult.mssv}`,
      ].join('\n');
      
      try {
        await navigator.clipboard.writeText(shareText);
        showToast('✅ Đã sao chép kết quả!');
      } catch {
        showToast('❌ Không thể chia sẻ. Thử lại sau.');
      }
    }
  } finally {
    shareBtn.innerHTML = originalHTML;
    shareBtn.disabled = false;
  }
}

/**
 * Xử lý cập nhật cache — gọi API clear_cache rồi tra cứu lại MSSV hiện tại.
 */
async function handleRefreshCache() {
  if (!currentResult) return;
  
  const btn = DOM.newSearchBtn;
  const originalText = btn.textContent;
  btn.textContent = '⏳ Đang cập nhật...';
  btn.disabled = true;
  
  try {
    // Gọi API xóa cache
    const clearRes = await jsonpAPI({ action: 'clear_cache' });
    console.log('🗑️ Cache cleared:', clearRes);
    
    // Tra cứu lại MSSV hiện tại với dữ liệu mới
    if (clearRes.status === 'ok') {
      const mssv = currentResult.mssv;
      setLoading(true);
      DOM.loadingCard.classList.remove('hidden');
      
      const data = await fetchStudentScore(mssv);
      
      if (data.status === 'ok') {
        currentResult = data;
        renderResult(data);
        showToast('✅ Dữ liệu đã được cập nhật!');
      } else {
        showToast('⚠️ Không thể cập nhật: ' + (data.message || 'Lỗi'));
      }
    } else {
      showToast('⚠️ Không thể xóa cache: ' + (clearRes.message || 'Lỗi'));
    }
  } catch (err) {
    showToast('❌ Lỗi: ' + err.message);
  } finally {
    setLoading(false);
    DOM.loadingCard.classList.add('hidden');
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

/**
 * Xử lý sort bảng chi tiết.
 * 
 * @param {string} field - Tên trường cần sort
 */
function handleSort(field) {
  if (!currentResult || !currentResult.chi_tiet) return;
  
  // Toggle sort direction
  if (currentSort.field === field) {
    currentSort.asc = !currentSort.asc;
  } else {
    currentSort.field = field;
    currentSort.asc = true;
  }
  
  // Cập nhật arrow indicators
  document.querySelectorAll('#detailTable .sort-arrow').forEach(arrow => {
    arrow.textContent = '↕';
  });
  
  const activeArrow = document.querySelector(`#detailTable th[data-sort="${field}"] .sort-arrow`);
  if (activeArrow) {
    activeArrow.textContent = currentSort.asc ? '↑' : '↓';
  }
  
  // Sort và render lại
  const sorted = [...currentResult.chi_tiet].sort((a, b) => {
    let valA = a[field];
    let valB = b[field];
    
    if (field === 'so_diem') {
      valA = parseFloat(valA) || 0;
      valB = parseFloat(valB) || 0;
    } else {
      valA = String(valA || '').toLowerCase();
      valB = String(valB || '').toLowerCase();
      return currentSort.asc ? valA.localeCompare(valB, 'vi') : valB.localeCompare(valA, 'vi');
    }
    
    return currentSort.asc ? valA - valB : valB - valA;
  });
  
  renderDetailRows(sorted);
}

// ═══════════════════════════════════════════════════════════════════════════
// RENDER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Render kết quả tra cứu.
 * 
 * @param {Object} data - Dữ liệu từ API
 */
function renderResult(data) {
  // Tổng điểm
  DOM.totalScore.textContent = data.tong_diem;
  
  // Thông tin sinh viên
  DOM.studentName.textContent = data.ho_ten;
  DOM.studentMssv.textContent = 'MSSV: ' + data.mssv;
  DOM.activityCount.textContent = data.so_hoat_dong + ' hoạt động';
  
  // Thời gian cập nhật
  if (data.cap_nhat_luc && data.cap_nhat_luc !== 'Chưa có dữ liệu') {
    DOM.lastUpdate.textContent = 'Cập nhật: ' + formatDate(data.cap_nhat_luc);
    DOM.footerUpdateTime.textContent = 'Cập nhật lần cuối: ' + formatDate(data.cap_nhat_luc);
  }
  
  // Cache indicator
  if (data._cached) {
    DOM.lastUpdate.innerHTML += ' <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 ml-1">📦 Cache</span>';
  } else {
    DOM.lastUpdate.innerHTML += ' <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 ml-1">✨ Mới</span>';
  }
  
  // Render bảng chi tiết
  renderDetailRows(data.chi_tiet);
  
  // Reset sort state
  currentSort = { field: null, asc: true };
  document.querySelectorAll('#detailTable .sort-arrow').forEach(a => a.textContent = '↕');
  
  // Animation: đếm điểm tăng dần
  animateScore(0, data.tong_diem, 800);
}

/**
 * Render các dòng chi tiết hoạt động.
 * 
 * @param {Array} details - Mảng chi tiết hoạt động
 */
function renderDetailRows(details) {
  DOM.detailBody.innerHTML = '';
  
  if (!details || details.length === 0) {
    DOM.detailBody.innerHTML = `
      <tr>
        <td colspan="4" class="py-8 text-center text-gray-400">
          Không có hoạt động nào
        </td>
      </tr>
    `;
    return;
  }
  
  details.forEach((item, index) => {
    const row = document.createElement('tr');
    row.className = index % 2 === 0 ? 'bg-gray-50/50' : 'bg-white';
    row.innerHTML = `
      <td class="py-3 px-2 sm:px-3 text-xs font-mono text-brand-700 font-semibold whitespace-nowrap">
        ${escapeHtml(item.muc || '—')}
      </td>
      <td class="py-3 px-2 sm:px-3 font-medium text-gray-800">
        ${escapeHtml(item.ten_hoat_dong)}
        <span class="block text-xs text-gray-400 font-normal sm:hidden">${escapeHtml(item.muc || '')}</span>
      </td>
      <td class="py-3 px-2 sm:px-3 text-center">
        <span class="inline-flex items-center justify-center px-2.5 py-1 rounded-full 
                     text-sm font-semibold ${getScoreBadgeClass(item.so_diem)}">
          +${item.so_diem}
        </span>
      </td>
      <td class="py-3 px-2 sm:px-3 text-gray-400 text-xs hidden sm:table-cell max-w-[120px] truncate" 
          title="${escapeHtml(item.file_goc || '')}">
        ${item.file_goc ? escapeHtml(item.file_goc) : '—'}
      </td>
    `;
    DOM.detailBody.appendChild(row);
  });
}

/**
 * Animation đếm điểm từ from lên to.
 */
function animateScore(from, to, duration) {
  const start = performance.now();
  
  function update(currentTime) {
    const elapsed = currentTime - start;
    const progress = Math.min(elapsed / duration, 1);
    
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = from + (to - from) * eased;
    
    DOM.totalScore.textContent = Math.round(current * 10) / 10;
    
    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      DOM.totalScore.textContent = to;
    }
  }
  
  requestAnimationFrame(update);
}

// ═══════════════════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hiển thị trạng thái loading.
 * 
 * @param {boolean} loading 
 */
function setLoading(loading) {
  isLoading = loading;
  DOM.searchBtn.disabled = loading;
  
  if (loading) {
    DOM.searchBtnText.classList.add('hidden');
    DOM.searchSpinner.classList.remove('hidden');
  } else {
    DOM.searchBtnText.classList.remove('hidden');
    DOM.searchSpinner.classList.add('hidden');
  }
}

/**
 * Ẩn tất cả các card.
 */
function hideAllCards() {
  DOM.loadingCard.classList.add('hidden');
  DOM.errorCard.classList.add('hidden');
  DOM.emptyCard.classList.add('hidden');
  DOM.resultCard.classList.add('hidden');
}

/**
 * Hiển thị trạng thái rỗng.
 */
function showEmptyState() {
  hideAllCards();
  DOM.emptyCard.classList.remove('hidden');
  currentResult = null;
}

/**
 * Hiển thị lỗi.
 * 
 * @param {string} title - Tiêu đề lỗi
 * @param {string} message - Nội dung lỗi
 */
function showError(title, message) {
  hideAllCards();
  DOM.errorTitle.textContent = title;
  DOM.errorMessage.textContent = message;
  DOM.errorCard.classList.remove('hidden');
  
  // Tự động ẩn sau 8 giây
  setTimeout(() => {
    DOM.errorCard.classList.add('hidden');
  }, 8000);
}

/**
 * Hiển thị toast notification.
 * 
 * @param {string} message - Nội dung toast
 */
function showToast(message) {
  // Tạo toast element
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-xl shadow-lg z-50 text-sm font-medium animate-fade-in';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  // Tự xóa sau 2.5 giây
  setTimeout(() => {
    toast.classList.add('opacity-0', 'transition-opacity', 'duration-300');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL STORAGE (Recent MSSV)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lưu MSSV vào lịch sử gần đây.
 * 
 * @param {string} mssv 
 */
function saveRecentMSSV(mssv) {
  try {
    let recent = JSON.parse(localStorage.getItem(CONFIG.RECENT_STORAGE_KEY) || '[]');
    
    // Xóa nếu đã tồn tại
    recent = recent.filter(r => r !== mssv);
    
    // Thêm vào đầu
    recent.unshift(mssv);
    
    // Giới hạn số lượng
    recent = recent.slice(0, CONFIG.MAX_RECENT_MSSV);
    
    localStorage.setItem(CONFIG.RECENT_STORAGE_KEY, JSON.stringify(recent));
    renderRecentMSSV();
  } catch (e) {
    // localStorage không khả dụng (private mode, etc.)
  }
}

/**
 * Render danh sách MSSV gần đây.
 */
function renderRecentMSSV() {
  try {
    const recent = JSON.parse(localStorage.getItem(CONFIG.RECENT_STORAGE_KEY) || '[]');
    
    if (recent.length === 0) {
      DOM.recentMssv.classList.add('hidden');
      return;
    }
    
    DOM.recentMssv.classList.remove('hidden');
    DOM.recentTags.innerHTML = '';
    
    recent.forEach(mssv => {
      const tag = document.createElement('button');
      tag.className = 'px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-mono transition-colors';
      tag.textContent = mssv;
      tag.addEventListener('click', () => {
        DOM.mssvInput.value = mssv;
        DOM.clearBtn.classList.remove('hidden');
        handleSearch();
      });
      DOM.recentTags.appendChild(tag);
    });
  } catch (e) {
    DOM.recentMssv.classList.add('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format ngày tháng hiển thị.
 * Hỗ trợ nhiều format đầu vào.
 * 
 * @param {string} dateStr - Chuỗi ngày tháng
 * @return {string} Ngày đã format (DD/MM/YYYY)
 */
function formatDate(dateStr) {
  if (!dateStr || dateStr === 'Chưa có dữ liệu' || dateStr === 'Không rõ') {
    return dateStr;
  }
  
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      const datePart = d.toLocaleDateString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
      });
      const timePart = d.toLocaleTimeString('vi-VN', {
        hour: '2-digit', minute: '2-digit',
      });
      // Nếu có giờ (không phải 00:00) thì hiển thị kèm
      if (timePart !== '00:00') {
        return datePart + ' ' + timePart;
      }
      return datePart;
    }
  } catch (e) {}
  
  return dateStr;
}

/**
 * Escape HTML để tránh XSS.
 * 
 * @param {string} str 
 * @return {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Lấy class CSS cho badge điểm.
 * 
 * @param {number} score 
 * @return {string} CSS class
 */
function getScoreBadgeClass(score) {
  if (score >= 3) return 'bg-green-100 text-green-800';
  if (score >= 2) return 'bg-blue-100 text-blue-800';
  if (score >= 1) return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-600';
}

/**
 * Debounce helper.
 * 
 * @param {Function} fn 
 * @param {number} delay 
 * @return {Function}
 */
// ═══════════════════════════════════════════════════════════════════════════
// PWA / SERVICE WORKER (Optional - for offline caching)
// ═══════════════════════════════════════════════════════════════════════════
// Uncomment nếu muốn hỗ trợ PWA:
// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('/sw.js');
// }

// End of script.js
