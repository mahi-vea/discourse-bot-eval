// Stub for discourse/lib/ajax-error.
export const errors = [];

export function reset() {
  errors.length = 0;
}

export function popupAjaxError(error) {
  errors.push(error);
}
