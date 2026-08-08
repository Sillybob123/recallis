import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import { StudyModeProvider } from "./contexts/StudyModeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Login } from "./pages/Login";
import { Signup } from "./pages/Signup";
import { Dashboard } from "./pages/Dashboard";
import { HomePage } from "./pages/HomePage";
import { NotesPage } from "./pages/NotesPage";
import { NoteEditorPage } from "./pages/NoteEditorPage";
import { DeckPage } from "./pages/DeckPage";
import { StudyBasic } from "./pages/StudyBasic";
import { StudyOcclusion } from "./pages/StudyOcclusion";
import { OcclusionEditor } from "./pages/OcclusionEditor";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <StudyModeProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/study-group" element={<ProtectedRoute><StudyBasic /></ProtectedRoute>} />
          <Route path="/notes" element={<ProtectedRoute><NotesPage /></ProtectedRoute>} />
          <Route path="/notes/:noteId" element={<ProtectedRoute><NoteEditorPage /></ProtectedRoute>} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/decks"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deck/:deckId"
            element={
              <ProtectedRoute>
                <DeckPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deck/:deckId/study"
            element={
              <ProtectedRoute>
                <StudyBasic />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deck/:deckId/study-occlusion"
            element={
              <ProtectedRoute>
                <StudyOcclusion />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deck/:deckId/occlusion/new"
            element={
              <ProtectedRoute>
                <OcclusionEditor />
              </ProtectedRoute>
            }
          />
          <Route
            path="/deck/:deckId/occlusion/:sheetId/edit"
            element={
              <ProtectedRoute>
                <OcclusionEditor />
              </ProtectedRoute>
            }
          />
        </Routes>
        </StudyModeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
