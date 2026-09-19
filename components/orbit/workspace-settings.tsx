'use client';
import type {Dispatch,SetStateAction} from 'react';
import {Download,ArrowUpRight} from 'lucide-react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Checkbox} from '@/components/ui/checkbox';
import {InstallSettings} from './install-app';
import {Choice} from './choice';
import {CosmicMotionToggle} from './cosmic-skin';
import type {View,Preferences} from '@/lib/orbit/model';
import {formatTime,withDefaults} from '@/lib/orbit/model';
interface Props {
 navigate:(view:View)=>void;cosmic:{enabled:boolean;reduced:boolean;toggle:()=>void};
 settingsOpen:boolean;setSettingsOpen:(open:boolean)=>void;
 settingsDraft:Preferences;setSettingsDraft:Dispatch<SetStateAction<Preferences>>;
 busy:boolean;exporting:boolean;loaded:boolean;demo:boolean;
 onSave:(preferences:Preferences)=>Promise<boolean>;downloadData:()=>Promise<void>;
}
export function WorkspaceSettings({settingsOpen,setSettingsOpen,settingsDraft,setSettingsDraft,busy,exporting,loaded,demo,onSave,downloadData,navigate,cosmic}:Props){
 return (
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="bg-white settings-dialog">
          <DialogHeader>
            <DialogTitle>설정</DialogTitle>
            <DialogDescription>계정 연결과 업무 환경을 관리합니다.</DialogDescription>
          </DialogHeader>
          <div className="dialog-form">
            <div className="settings-connection-links"><button type="button" className="secondary-button" disabled={demo} onClick={()=>{setSettingsOpen(false);window.dispatchEvent(new Event('orbit:connections'))}}>계정·연결 관리</button><button type="button" className="secondary-button" disabled={demo} onClick={()=>{setSettingsOpen(false);window.dispatchEvent(new Event('orbit:runtime'))}}>자동 실행 설정</button></div>
            <details className="workspace-more"><summary>업무 시간·계획 기준</summary><div className="dialog-form">
            <label className="form-label">시간대</label>
            <Choice
              label="시간대"
              value={settingsDraft.timeZone}
              onChange={(v) => setSettingsDraft((p) => ({ ...p, timeZone: v }))}
              items={[
                { value: 'Asia/Seoul', label: '서울 · Asia/Seoul' },
                { value: 'Asia/Tokyo', label: '도쿄 · Asia/Tokyo' },
                { value: 'America/Los_Angeles', label: '로스앤젤레스' },
                { value: 'America/New_York', label: '뉴욕' },
                { value: 'Europe/London', label: '런던' },
                { value: 'UTC', label: 'UTC' },
              ]}
            />
            <div className="field-grid">
              <label className="form-label">
                업무 시작
                <input
                  type="time"
                  className="form-field"
                  value={formatTime(settingsDraft.workStart)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setSettingsDraft((p) => ({ ...p, workStart: h * 60 + m }));
                  }}
                />
              </label>
              <label className="form-label">
                업무 종료
                <input
                  type="time"
                  className="form-field"
                  value={formatTime(settingsDraft.workEnd)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setSettingsDraft((p) => ({ ...p, workEnd: h * 60 + m }));
                  }}
                />
              </label>
            </div>
            <label className="form-label">업무 요일</label>
            <div className="workdays">
              {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
                <label key={d}>
                  <Checkbox
                    checked={settingsDraft.workDays.includes(i)}
                    onCheckedChange={(v) =>
                      setSettingsDraft((p) => ({
                        ...p,
                        workDays: v ? [...p.workDays, i] : p.workDays.filter((x) => x !== i),
                      }))
                    }
                  />
                  {d}
                </label>
              ))}
            </div>
            <div className="field-grid">
              <div>
                <label className="form-label">핵심 결과물 최대 개수</label>
                <Choice
                  label="핵심 결과물 최대 개수"
                  value={String(settingsDraft.focusLimit)}
                  onChange={(v) => setSettingsDraft((p) => ({ ...p, focusLimit: Number(v) }))}
                  items={[1, 2, 3, 4, 5].map((v) => ({ value: String(v), label: `${v}개` }))}
                />
              </div>
              <div>
                <label className="form-label">비워둘 시간</label>
                <Choice
                  label="여유 시간 비율"
                  value={String(settingsDraft.bufferFraction)}
                  onChange={(v) => setSettingsDraft((p) => ({ ...p, bufferFraction: Number(v) }))}
                  items={[0.1, 0.2, 0.3, 0.4, 0.5].map((v) => ({ value: String(v), label: `${v * 100}%` }))}
                />
              </div>
            </div>
            <div className="divider" />
            <label className="form-label">BRAINY 리듬 · 집중이 가장 좋은 구간</label>
            <div className="field-grid">
              <label className="form-label">
                시작
                <input
                  type="time"
                  className="form-field"
                  value={formatTime(withDefaults(settingsDraft).rhythm.peakStart)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setSettingsDraft((p) => ({
                      ...p,
                      rhythm: { ...withDefaults(p).rhythm, peakStart: h * 60 + m },
                    }));
                  }}
                />
              </label>
              <label className="form-label">
                끝
                <input
                  type="time"
                  className="form-field"
                  value={formatTime(withDefaults(settingsDraft).rhythm.peakEnd)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setSettingsDraft((p) => ({
                      ...p,
                      rhythm: { ...withDefaults(p).rhythm, peakEnd: h * 60 + m },
                    }));
                  }}
                />
              </label>
            </div>
            <label className="form-label">점심 (먼저 비워둡니다)</label>
            <div className="field-grid">
              <label className="form-label">
                시작
                <input
                  type="time"
                  className="form-field"
                  value={formatTime(withDefaults(settingsDraft).rhythm.lunchStart)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setSettingsDraft((p) => ({
                      ...p,
                      rhythm: { ...withDefaults(p).rhythm, lunchStart: h * 60 + m },
                    }));
                  }}
                />
              </label>
              <label className="form-label">
                끝
                <input
                  type="time"
                  className="form-field"
                  value={formatTime(withDefaults(settingsDraft).rhythm.lunchEnd)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    setSettingsDraft((p) => ({
                      ...p,
                      rhythm: { ...withDefaults(p).rhythm, lunchEnd: h * 60 + m },
                    }));
                  }}
                />
              </label>
            </div>
            <div className="field-grid">
              <div>
                <label className="form-label">Goal Laser 연속 시간</label>
                <Choice
                  label="Goal Laser 연속 시간"
                  value={String(withDefaults(settingsDraft).laserMinutes)}
                  onChange={(v) => setSettingsDraft((p) => ({ ...p, laserMinutes: Number(v) }))}
                  items={[90, 120, 150, 180, 240].map((v) => ({ value: String(v), label: `${v}분` }))}
                />
              </div>
              <div>
                <label className="form-label">회의 앞뒤 이동 버퍼</label>
                <Choice
                  label="이동 버퍼"
                  value={String(withDefaults(settingsDraft).travelMinutes)}
                  onChange={(v) => setSettingsDraft((p) => ({ ...p, travelMinutes: Number(v) }))}
                  items={[0, 15, 30, 45, 60].map((v) => ({ value: String(v), label: v ? `${v}분` : '없음' }))}
                />
              </div>
            </div>
            <label className="form-label">일정 색상 기준</label>
            <Choice
              label="일정 색상 기준"
              value={withDefaults(settingsDraft).colorBy}
              onChange={(v) => setSettingsDraft((p) => ({ ...p, colorBy: v as 'project' | 'cognition' }))}
              items={[
                { value: 'project', label: '프로젝트 색' },
                { value: 'cognition', label: '인지 등급 4색 (고위·중위·저위·외부)' },
              ]}
            />
            <button
              className="primary-button full-width"
              disabled={busy}
              style={{ marginTop: 24 }}
              onClick={async () => {
                if(await onSave(settingsDraft))setSettingsOpen(false);
              }}
            >
              설정 저장
            </button>
            </div></details>
            <details className="workspace-more"><summary>데이터·백업</summary><div className="dialog-form"><div className="settings-connection-links"><button className="secondary-button" onClick={()=>{setSettingsOpen(false);navigate('data')}}>데이터 관리</button><button className="secondary-button" onClick={()=>{setSettingsOpen(false);navigate('backup')}}>백업·복구</button></div>
            <button
              className="secondary-button full-width"
              disabled={exporting || !loaded}
              onClick={() => void downloadData()}
            >
              <Download size={16} />
              {exporting ? '내보내는 중…' : '내 기록 JSON으로 내보내기'}
            </button>
            <p className="form-hint">
              저장된 기록과 모든 문서의 현재 본문이 포함됩니다. 작성 중인 폼과 과거 문서 이력은 포함되지
              않습니다. 전체 백업과 선택 복구는 백업·복구 화면에서 이용하세요.
            </p>
            <div className="divider" />
            </div></details><details className="workspace-more"><summary>앱·화면</summary><div className="dialog-form"><CosmicMotionToggle enabled={cosmic.enabled} reduced={cosmic.reduced} onToggle={cosmic.toggle}/>
            <InstallSettings />
            <p className="form-hint">
              오프라인에서는 안내 화면이 표시됩니다. 업무 기록의 열람과 저장에는 연결이 필요합니다.
            </p>
            {!demo && (
              <a className="text-button" style={{ marginTop: 10 }} href="/demo">
                예시 체험 화면 열기
                <ArrowUpRight size={14} />
              </a>
            )}
          </div></details></div>
        </DialogContent>
      </Dialog>
 );
}
