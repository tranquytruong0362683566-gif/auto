(function () {
  'use strict';

  const TOKENS = Object.freeze({
    ARTICLE: '{{ARTICLE}}',
    CATEGORY: '{{CATEGORY}}',
    SUBJECT: '{{SUBJECT}}',
    DETAILS: '{{DETAILS}}',
    CONTACT: '{{CONTACT}}',
    LINK: '{{LINK}}',
    TONE: '{{TONE}}'
  });

  const categories = Object.freeze({
    sales: Object.freeze({
      id: 'sales',
      label: 'Bán hàng/Affiliate',
      shortLabel: 'Bán hàng',
      icon: '🛒',
      subjectLabel: 'Tên sản phẩm',
      subjectPlaceholder: 'VD: Inverter LuxPower SNA PRO 6.5K',
      detailsLabel: 'Thông tin sản phẩm',
      detailsPlaceholder: 'Giá, thông số, ưu điểm, bảo hành, khu vực giao hàng...',
      contactLabel: 'Liên hệ bán hàng',
      contactPlaceholder: 'Số điện thoại, Zalo hoặc cách liên hệ',
      linkLabel: 'Link sản phẩm/Affiliate',
      linkPlaceholder: 'Mỗi link một dòng. Hệ thống dùng lần lượt khi tạo bình luận.',
      classifierPrompt: `Bạn là bộ phân loại bài viết Facebook cho chiến dịch Bán hàng/Affiliate.

Hãy đọc bài viết và dữ liệu sản phẩm rồi chọn đúng một kết quả:
- Trả về comment khi người đăng đang cần mua, tìm mua, xin tư vấn, hỏi giá, hỏi nơi bán, xin gợi ý hoặc thể hiện nhu cầu có thể phù hợp với sản phẩm.
- Trả về (next) khi người đăng đang bán hàng, đăng sản phẩm, thanh lý, quảng cáo, báo giá, tuyển đại lý, tìm khách hoặc cung cấp dịch vụ.
- Trả về (next) khi bài không liên quan hoặc không có nhu cầu phù hợp.

Sản phẩm: {{SUBJECT}}
Thông tin sản phẩm: {{DETAILS}}
Bài viết cần phân loại:
"""
{{ARTICLE}}
"""`,
      replyPrompt: `Viết một bình luận Facebook tiếng Việt tự nhiên cho người đang có nhu cầu mua hoặc tìm hiểu sản phẩm.

Bài viết gốc:
"""
{{ARTICLE}}
"""

Sản phẩm: {{SUBJECT}}
Thông tin: {{DETAILS}}
Liên hệ: {{CONTACT}}
Link được phép dùng: {{LINK}}
Phong cách: {{TONE}}

Yêu cầu:
- Mở đầu bám vào một chi tiết trong bài viết.
- Giới thiệu sản phẩm mềm mại, không phóng đại và không giả vờ đã sử dụng.
- Nếu có link thì đặt URL trần gần cuối bình luận.
- Viết 2–4 câu ngắn, không hashtag, tối đa một emoji.
- Câu cuối không có dấu chấm.`
    }),

    recruitment: Object.freeze({
      id: 'recruitment',
      label: 'Tuyển dụng',
      shortLabel: 'Tuyển dụng',
      icon: '💼',
      subjectLabel: 'Vị trí tuyển dụng',
      subjectPlaceholder: 'VD: Nhân viên kho tại Thái Nguyên',
      detailsLabel: 'Thông tin công việc',
      detailsPlaceholder: 'Địa điểm, lương, ca làm, yêu cầu, quyền lợi...',
      contactLabel: 'Liên hệ ứng tuyển',
      contactPlaceholder: 'Số điện thoại, Zalo hoặc cách nộp hồ sơ',
      linkLabel: 'Link ứng tuyển',
      linkPlaceholder: 'Mỗi link một dòng, có thể để trống nếu ứng tuyển qua điện thoại/Zalo.',
      classifierPrompt: `Bạn là bộ phân loại bài viết Facebook cho chiến dịch Tuyển dụng.

Hãy đọc bài viết và dữ liệu công việc rồi chọn đúng một kết quả:
- Trả về comment khi người đăng đang tìm việc, xin việc, cần việc làm, tìm việc làm thêm hoặc hỏi nơi tuyển phù hợp.
- Trả về (next) khi bài viết đang tuyển người, đăng tin tuyển dụng, môi giới việc làm, tuyển cộng tác viên hoặc quảng cáo khóa học việc làm.
- Trả về (next) khi khu vực, loại việc hoặc nhu cầu không phù hợp rõ ràng.

Vị trí đang tuyển: {{SUBJECT}}
Thông tin công việc: {{DETAILS}}
Bài viết cần phân loại:
"""
{{ARTICLE}}
"""`,
      replyPrompt: `Viết một bình luận Facebook tiếng Việt tự nhiên cho người đang tìm việc.

Bài viết gốc:
"""
{{ARTICLE}}
"""

Vị trí đang tuyển: {{SUBJECT}}
Thông tin công việc: {{DETAILS}}
Liên hệ ứng tuyển: {{CONTACT}}
Link ứng tuyển: {{LINK}}
Phong cách: {{TONE}}

Yêu cầu:
- Mở đầu bám đúng nhu cầu tìm việc trong bài.
- Nêu ngắn gọn vị trí, khu vực, mức lương hoặc ca làm nếu dữ liệu có cung cấp.
- Không tự bịa lương, quyền lợi hoặc yêu cầu.
- Viết 2–4 câu ngắn và kết thúc bằng cách liên hệ hoặc ứng tuyển.
- Câu cuối không có dấu chấm.`
    }),

    rental: Object.freeze({
      id: 'rental',
      label: 'Cho thuê phòng',
      shortLabel: 'Cho thuê phòng',
      icon: '🏠',
      subjectLabel: 'Tên phòng/nhà cho thuê',
      subjectPlaceholder: 'VD: Phòng khép kín gần KCN Yên Bình',
      detailsLabel: 'Thông tin phòng',
      detailsPlaceholder: 'Địa chỉ, giá thuê, diện tích, nội thất, điện nước, tiện ích...',
      contactLabel: 'Liên hệ xem phòng',
      contactPlaceholder: 'Số điện thoại, Zalo hoặc thời gian xem phòng',
      linkLabel: 'Link thông tin phòng',
      linkPlaceholder: 'Mỗi link một dòng, có thể là link ảnh, bài đăng hoặc trang thông tin.',
      classifierPrompt: `Bạn là bộ phân loại bài viết Facebook cho chiến dịch Cho thuê phòng.

Hãy đọc bài viết và dữ liệu phòng rồi chọn đúng một kết quả:
- Trả về comment khi người đăng đang tìm phòng, cần thuê phòng, tìm nhà thuê, hỏi phòng trống hoặc nhờ giới thiệu chỗ ở.
- Trả về (next) khi bài viết đang cho thuê phòng, đăng phòng trống, sang nhượng phòng, môi giới nhà trọ hoặc quảng cáo chỗ ở.
- Trả về (next) khi khu vực, ngân sách hoặc loại phòng không phù hợp rõ ràng.

Phòng đang cho thuê: {{SUBJECT}}
Thông tin phòng: {{DETAILS}}
Bài viết cần phân loại:
"""
{{ARTICLE}}
"""`,
      replyPrompt: `Viết một bình luận Facebook tiếng Việt tự nhiên cho người đang tìm phòng hoặc nhà thuê.

Bài viết gốc:
"""
{{ARTICLE}}
"""

Phòng đang cho thuê: {{SUBJECT}}
Thông tin phòng: {{DETAILS}}
Liên hệ xem phòng: {{CONTACT}}
Link thông tin: {{LINK}}
Phong cách: {{TONE}}

Yêu cầu:
- Mở đầu bám vào khu vực, ngân sách hoặc loại phòng người đăng đang tìm.
- Chỉ nêu giá, diện tích và tiện ích có trong dữ liệu.
- Nếu chưa đủ dữ liệu để khẳng định phù hợp, dùng cách nói mềm như “có thể tham khảo”.
- Viết 2–4 câu ngắn và kết thúc bằng lời mời xem ảnh hoặc xem phòng.
- Câu cuối không có dấu chấm.`
    }),

    real_estate: Object.freeze({
      id: 'real_estate',
      label: 'Bán bất động sản',
      shortLabel: 'Bất động sản',
      icon: '🏢',
      subjectLabel: 'Tên bất động sản',
      subjectPlaceholder: 'VD: Đất nền Phổ Yên 100 m²',
      detailsLabel: 'Thông tin bất động sản',
      detailsPlaceholder: 'Loại tài sản, vị trí, diện tích, giá bán, pháp lý, tiện ích...',
      contactLabel: 'Liên hệ xem bất động sản',
      contactPlaceholder: 'Số điện thoại, Zalo hoặc lịch hẹn xem',
      linkLabel: 'Link bất động sản',
      linkPlaceholder: 'Mỗi link một dòng, có thể là bài đăng hoặc trang thông tin chi tiết.',
      classifierPrompt: `Bạn là bộ phân loại bài viết Facebook cho chiến dịch Bán bất động sản.

Hãy đọc bài viết và dữ liệu bất động sản rồi chọn đúng một kết quả:
- Trả về comment khi người đăng đang cần mua nhà, mua đất, tìm căn hộ, tìm bất động sản đầu tư hoặc nhờ giới thiệu tài sản phù hợp.
- Trả về (next) khi bài viết đang rao bán nhà đất, đăng sản phẩm bất động sản, là môi giới tìm khách, thanh lý hoặc quảng cáo dự án.
- Trả về (next) khi khu vực, ngân sách hoặc loại bất động sản không phù hợp rõ ràng.

Bất động sản đang bán: {{SUBJECT}}
Thông tin: {{DETAILS}}
Bài viết cần phân loại:
"""
{{ARTICLE}}
"""`,
      replyPrompt: `Viết một bình luận Facebook tiếng Việt tự nhiên cho người đang tìm mua bất động sản.

Bài viết gốc:
"""
{{ARTICLE}}
"""

Bất động sản đang bán: {{SUBJECT}}
Thông tin: {{DETAILS}}
Liên hệ xem tài sản: {{CONTACT}}
Link thông tin: {{LINK}}
Phong cách: {{TONE}}

Yêu cầu:
- Mở đầu bám vào khu vực, ngân sách hoặc loại tài sản người đăng đang tìm.
- Chỉ nêu diện tích, giá và pháp lý có trong dữ liệu.
- Không tự bịa pháp lý, vị trí hoặc cam kết sinh lời.
- Viết 2–4 câu ngắn và kết thúc bằng lời mời xem hình ảnh hoặc vị trí chi tiết.
- Câu cuối không có dấu chấm.`
    })
  });

  const orderedCategoryIds = Object.freeze(['sales', 'recruitment', 'rental', 'real_estate']);

  function getCategory(categoryId) {
    return categories[categoryId] || categories.sales;
  }

  window.AutoVipCampaignConfig = Object.freeze({
    TOKENS,
    categories,
    orderedCategoryIds,
    getCategory
  });
})();
