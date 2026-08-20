import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "../stores/auth.js";

import Login from "../views/Login.vue";
import Dashboard from "../views/Dashboard.vue";
import Customers from "../views/Customers.vue";
import Armada from "../views/Armada.vue";
import Material from "../views/Material.vue";
import Invoices from "../views/Invoices.vue";
import InvoiceDetail from "../views/InvoiceDetail.vue";
import SuratJalan from "../views/SuratJalan.vue";
import DivisiLaporan from "../views/DivisiLaporan.vue";
import Users from "../views/Users.vue";
import RekapPenjualan from "../views/RekapPenjualan.vue";

const routes = [
  { path: "/login", name: "login", component: Login, meta: { public: true } },
  { path: "/", name: "dashboard", component: Dashboard },
  { path: "/customers", name: "customers", component: Customers },
  { path: "/armada", name: "armada", component: Armada },
  { path: "/material", name: "material", component: Material },
  { path: "/invoices", name: "invoices", component: Invoices },
  { path: "/invoices/:id", name: "invoice-detail", component: InvoiceDetail },
  { path: "/surat-jalan", name: "surat-jalan", component: SuratJalan },
  { path: "/laporan-divisi", name: "laporan-divisi", component: DivisiLaporan },
  { path: "/rekap-penjualan", name: "rekap-penjualan", component: RekapPenjualan },
  { path: "/users", name: "users", component: Users, meta: { adminOnly: true } },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const auth = useAuthStore();
  if (!to.meta.public && !auth.isLoggedIn) {
    return { name: "login" };
  }
  if (to.meta.adminOnly && !auth.isAdmin) {
    return { name: "dashboard" };
  }
  if (to.name === "login" && auth.isLoggedIn) {
    return { name: "dashboard" };
  }
  return true;
});

export default router;
