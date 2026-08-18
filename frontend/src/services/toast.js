import { reactive } from "vue";

const state = reactive({ message: "", visible: false });
let timer = null;

export function toast(message) {
  state.message = message;
  state.visible = true;
  clearTimeout(timer);
  timer = setTimeout(() => {
    state.visible = false;
  }, 2800);
}

export function useToastState() {
  return state;
}
