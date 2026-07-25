import { useTrainingStore } from '../state/trainingStore';
import { LessonSelect } from './LessonSelect';
import { TrainingViewport } from '../training/TrainingViewport';

// Top-level Training section: the lesson list when nothing is active, otherwise
// the live lesson (flight view + Director + training HUD).
export function TrainingScreen() {
  const activeLessonId = useTrainingStore((s) => s.activeLessonId);
  return activeLessonId ? <TrainingViewport /> : <LessonSelect />;
}
