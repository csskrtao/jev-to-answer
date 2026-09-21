/** 给外部服务统一设置截止时间；同时取消网络请求并返回可读错误。 */
export async function withTimeout(operation, milliseconds, label) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error(`${label}请求超时，请稍后重试`), { status: 504 });
      controller.abort(error);
      reject(error);
    }, milliseconds);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
