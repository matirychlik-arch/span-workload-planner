export type OnboardingStep = {
  id: string;
  selector: string;
  title: string;
  benefit: string;
  placement: 'top' | 'right' | 'bottom' | 'left';
};

export const onboardingSteps: OnboardingStep[] = [
  {
    id: 'backlog',
    selector: '[data-onboarding="backlog"]',
    title: 'Backlog',
    benefit: 'Taski z Jiry i ręczne wrzutki masz w jednym miejscu, bez przepisywania między narzędziami.',
    placement: 'right'
  },
  {
    id: 'timeline',
    selector: '[data-onboarding="timeline"]',
    title: 'Timeline',
    benefit: 'Widzisz realne obłożenie godzinowe zespołu, a nie tylko listę zadań.',
    placement: 'bottom'
  },
  {
    id: 'resize',
    selector: '[data-onboarding="resize"]',
    title: 'Resize',
    benefit: 'Zmieniasz czas trwania bloków bez ręcznego liczenia i bez rozsypywania planu.',
    placement: 'left'
  },
  {
    id: 'multiselect',
    selector: '[data-onboarding="multiselect"]',
    title: 'Multi-select',
    benefit: 'Przenosisz kilka bloków naraz, gdy zmienia się plan dnia lub sprintu.',
    placement: 'top'
  }
];
