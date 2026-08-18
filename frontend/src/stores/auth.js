import { defineStore } from "pinia";
import { api } from "../services/api.js";

export const useAuthStore = defineStore("auth", {
  state: () => ({
    user: JSON.parse(localStorage.getItem("bms_user") || "null"),
    token: localStorage.getItem("bms_token") || null,
  }),
  getters: {
    isLoggedIn: (state) => !!state.token,
    isAdmin: (state) => state.user?.role === "ADMIN",
  },
  actions: {
    async login(username, password) {
      const data = await api.post("/auth/login", { username, password });
      this.token = data.token;
      this.user = data.user;
      localStorage.setItem("bms_token", data.token);
      localStorage.setItem("bms_user", JSON.stringify(data.user));
    },
    logout() {
      this.token = null;
      this.user = null;
      localStorage.removeItem("bms_token");
      localStorage.removeItem("bms_user");
    },
  },
});
