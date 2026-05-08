import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import AdminPage from "./pages/AdminPage";
import EngineerKpiPage from "./pages/EngineerKpiPage";
import Home from "./pages/Home";
import ImportPage from "./pages/ImportPage";
import LoginPage from "./pages/LoginPage";
import OperationsPage from "./pages/OperationsPage";
import PendingStockMismatchPage from "./pages/PendingStockMismatchPage";
import SamplingPage from "./pages/SamplingPage";
import StationPage from "./pages/StationPage";

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/operations" component={OperationsPage} />
      <Route path="/import" component={ImportPage} />
      <Route path="/station/:stationCode" component={StationPage} />
      <Route path="/sampling" component={SamplingPage} />
      <Route path="/kpi" component={EngineerKpiPage} />
      <Route path="/admin/pending-stock-mismatches" component={PendingStockMismatchPage} />
      <Route path="/admin/:section" component={AdminPage} />
      <Route path="/admin" component={AdminPage} />
      <Route path="/404" component={NotFound} />
      <Route path="/" component={Home} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster position="top-center" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
