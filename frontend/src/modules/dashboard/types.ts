export type Card = { count: number; percent: number };
export type Cards = {
    nonCompliance: Card;
    lateClosure: Card;
    onTime: Card;
    due: Card;
    notApplicable: Card;
    pendingApproval: Card;
};
export type Counts = {
    nonCompliance: number;
    lateClosure: number;
    onTime: number;
    due: number;
    notApplicable: number;
    pendingApproval: number;
};
export type Period = { kind: string; from: string; to: string; label: string; financialYear: string | null };

export type Summary = {
    asOf: string;
    period: Period;
    total: number;
    applicable: number;
    cards: Cards;
    headline: { pendingForSubmission: number; oldestDueDate: string | null };
};

export type Bucket = { counts: Counts; total: number; from: string; to: string };
export type Charts = {
    asOf: string;
    period: Period;
    financialYear: string;
    yearly: (Bucket & { financialYear: string })[];
    quarterly: (Bucket & { quarter: string })[];
    monthly: (Bucket & { month: string; label: string })[];
    nonComplianceByRisk: { risk: 'HIGH' | 'MEDIUM' | 'LOW'; count: number }[];
};