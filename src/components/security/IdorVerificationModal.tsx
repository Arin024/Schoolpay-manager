import React, { useState } from 'react';
import { X, ShieldAlert, ShieldCheck, Play, ArrowRight, AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { api } from '../../services/api.js';

interface IdorVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const IdorVerificationModal: React.FC<IdorVerificationModalProps> = ({ isOpen, onClose }) => {
  const { user, activeSchoolId, activeSchool, isSuperAdmin } = useAuth();
  const [foreignId, setForeignId] = useState(
    activeSchoolId === 'sch_lagos_premier_01' ? 'sch_abuja_horizon_02' : 'sch_lagos_premier_01'
  );
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  if (!isOpen) return null;

  const runVerification = async () => {
    setTesting(true);
    setResult(null);

    try {
      const response = await api.simulateIdor(foreignId);
      setResult(response);
    } catch (err: any) {
      setResult({ status: 500, ok: false, data: { message: err?.message || 'Network error' } });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl border border-slate-200 overflow-hidden">
        {/* Modal Header */}
        <div className="bg-slate-900 px-6 py-4 flex items-center justify-between text-white border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white">Tenant Isolation &amp; IDOR Verification Center</h3>
              <p className="text-[11px] text-slate-400">Live proof of server-side tenant boundary enforcement</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {/* Requirement Explainer */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-slate-900">
              <Lock className="w-3.5 h-3.5 text-emerald-600" />
              <span>Core Business &amp; Architectural Invariant:</span>
            </div>
            <p>
              &quot;One school must NEVER be able to access another school&apos;s data. Never rely on frontend filtering for tenant security. If School A user attempts to request School B&apos;s records, the server must reject with an authorization error.&quot;
            </p>
          </div>

          {/* Test Setup */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-emerald-50/40">
              <p className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Your Current Authenticated Context</p>
              <p className="font-bold text-slate-900 mt-1">{user?.full_name}</p>
              <p className="text-slate-600 font-mono text-[11px] mt-0.5">Email: {user?.email}</p>
              <p className="text-emerald-700 font-mono text-[11px] mt-0.5">
                Authorized Tenant: <strong>{activeSchoolId || '(None - Super Admin)'}</strong>
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-amber-50/40">
              <p className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Target Foreign Tenant to Infiltrate</p>
              <input
                type="text"
                value={foreignId}
                onChange={(e) => setForeignId(e.target.value)}
                placeholder="Foreign school_id"
                className="w-full mt-1 px-2.5 py-1.5 font-mono text-xs bg-white border border-amber-300 rounded-lg focus:ring-1 focus:ring-amber-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Preset choices: <button type="button" onClick={() => setForeignId('sch_lagos_premier_01')} className="underline text-slate-700">Lagos (sch_lagos_premier_01)</button> | <button type="button" onClick={() => setForeignId('sch_abuja_horizon_02')} className="underline text-slate-700">Abuja (sch_abuja_horizon_02)</button>
              </p>
            </div>
          </div>

          {/* Execution Button */}
          <div className="flex justify-end">
            <button
              onClick={runVerification}
              disabled={testing}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 text-emerald-400" />
              <span>{testing ? 'Probing Server...' : 'Dispatch Cross-Tenant Request to Server'}</span>
            </button>
          </div>

          {/* Result Output Display */}
          {result && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Live Server Response:
              </p>

              {result.status === 403 ? (
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    <span>TENANT GUARD ENFORCED: HTTP 403 FORBIDDEN</span>
                  </div>
                  <p>
                    The server detected that your account is not authorized for tenant <code className="bg-emerald-100 px-1 py-0.5 rounded font-mono">{foreignId}</code>.
                    The request was blocked immediately with error code: <strong>{result.data.code || 'IDOR_PREVENTED'}</strong>.
                  </p>
                  <p className="text-[11px] text-emerald-700">
                    Security Action: An <strong>IDOR_SECURITY_VIOLATION</strong> entry was logged to the platform audit logs with your IP and timestamp.
                  </p>
                  <pre className="p-2.5 bg-emerald-950 text-emerald-300 rounded-lg text-[10px] font-mono overflow-x-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ) : result.status === 200 && isSuperAdmin ? (
                <div className="p-4 rounded-xl bg-purple-50 border border-purple-300 text-purple-900 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm text-purple-800">
                    <ShieldCheck className="w-5 h-5 text-purple-600" />
                    <span>SUPER ADMIN GOVERNANCE PASS: HTTP 200 OK</span>
                  </div>
                  <p>
                    Because your active account is marked with <code className="bg-purple-100 px-1 py-0.5 rounded font-mono">is_platform_admin = 1</code>, access is permitted at the platform governance layer.
                  </p>
                  <pre className="p-2.5 bg-slate-900 text-purple-300 rounded-lg text-[10px] font-mono overflow-x-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-300 text-slate-800 text-xs space-y-2">
                  <p className="font-bold">HTTP Status: {result.status}</p>
                  <pre className="p-2.5 bg-slate-900 text-slate-200 rounded-lg text-[10px] font-mono overflow-x-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 px-6 py-3 border-t border-slate-200 flex justify-between items-center text-xs">
          <span className="text-slate-500">Security Architecture: Zero-Trust Tenant Guard</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 rounded-lg font-semibold text-slate-700 hover:bg-slate-100"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
