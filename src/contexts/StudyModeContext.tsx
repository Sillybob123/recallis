import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type StudyMode = "anki" | "quizlet";

const StudyModeContext = createContext<{
  studyMode: StudyMode;
  setStudyMode: (m: StudyMode) => void;
}>({ studyMode: "quizlet", setStudyMode: () => {} });

export function StudyModeProvider({ children }: { children: ReactNode }) {
  const [studyMode, setStudyMode] = useState<StudyMode>(() => {
    const saved = localStorage.getItem("studyMode");
    return saved === "anki" ? "anki" : "quizlet";
  });

  useEffect(() => {
    localStorage.setItem("studyMode", studyMode);
  }, [studyMode]);

  return (
    <StudyModeContext.Provider value={{ studyMode, setStudyMode }}>
      {children}
    </StudyModeContext.Provider>
  );
}

export function useStudyMode() {
  return useContext(StudyModeContext);
}
