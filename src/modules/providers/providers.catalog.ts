/**
 * Danh mục các nhà cung cấp AI mà TokenScope hỗ trợ kết nối thật.
 *
 * Mỗi nhà cung cấp mô tả:
 * - thông tin hiển thị,
 * - endpoint kiểm tra kết nối (dùng API key),
 * - endpoint đọc usage/billing (nếu nhà cung cấp công bố).
 */
export interface ProviderDefinition {
  /** Mã định danh — `openai`. */
  id: string;
  /** Tên hiển thị. */
  name: string;
  /** Chữ cái hiển thị trong ô logo. */
  letter: string;
  /** Base URL của API. */
  baseUrl: string;
  /** Trang quản lý API Key chính thức. */
  apiKeyUrl: string;
  /** Gợi ý định dạng khóa. */
  keyHint: string;
  /** Nhà cung cấp có công bố API usage/billing hay không. */
  supportsUsage: boolean;
  /** Ghi chú về giới hạn dữ liệu billing. */
  usageNote: string;
}

export const PROVIDER_CATALOG: ProviderDefinition[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    letter: 'O',
    baseUrl: 'https://api.openai.com',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
    supportsUsage: true,
    usageNote:
      'Đồng bộ token & chi phí qua Organization Usage API — cần khoá có quyền admin organization.',
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    letter: 'A',
    baseUrl: 'https://api.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
    supportsUsage: true,
    usageNote:
      'Báo cáo usage chỉ khả dụng với khoá quản trị tổ chức (admin key).',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    letter: 'G',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'AIza...',
    supportsUsage: false,
    usageNote:
      'Google AI Studio không công bố API billing đầy đủ — chi phí được ước tính từ số token.',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    letter: 'M',
    baseUrl: 'https://api.mistral.ai',
    apiKeyUrl: 'https://console.mistral.ai/api-keys',
    keyHint: 'sk-...',
    supportsUsage: false,
    usageNote:
      'Mistral chưa công bố endpoint usage chi phí cho API key thông thường.',
  },
  {
    id: 'groq',
    name: 'Groq',
    letter: 'G',
    baseUrl: 'https://api.groq.com',
    apiKeyUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
    supportsUsage: false,
    usageNote:
      'Groq không cung cấp endpoint billing công khai — chỉ đồng bộ được danh sách model.',
  },
];

/** Tìm định nghĩa nhà cung cấp theo mã. */
export function findProviderDefinition(id: string): ProviderDefinition | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}
