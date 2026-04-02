import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from './axiosConfig';
import './AssistantHub.css';

const dayOptions = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function AssistantHub() {
  const navigate = useNavigate();
  const [selectedDays, setSelectedDays] = useState(['周一', '周二', '周三', '周四', '周五']);
  const [duration, setDuration] = useState(60);
  const [scheduleResult, setScheduleResult] = useState([]);

  const [taskInput, setTaskInput] = useState('');
  const [taskPlan, setTaskPlan] = useState([]);
  const [taskSummary, setTaskSummary] = useState('');

  const toggleDay = (day) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  const runScheduleSuggest = async () => {
    const response = await axios.post('/assistant/suggest-schedule', {
      preferred_days: selectedDays,
      duration,
      hour_start: 9,
      hour_end: 20,
    });
    setScheduleResult(response.data?.suggestions || []);
  };

  const runTaskPlan = async () => {
    if (!taskInput.trim()) return;
    const response = await axios.post('/assistant/task-plan', { text: taskInput.trim() });
    setTaskPlan(response.data?.checkpoints || []);
    setTaskSummary(response.data?.summary || '');
  };

  const saveCheckpointAsTask = async (cp) => {
    await axios.post('/tasks', {
      title: cp.title,
      description: `AI 助手拆解步骤 ${cp.step}`,
      status: 'todo',
      priority: 'medium',
    });
  };

  return (
    <div className="assistant-page">
      <header>
        <h2>AI 助手系统</h2>
        <button onClick={() => navigate('/')}>返回工作台</button>
      </header>

      <section className="assistant-grid">
        <div className="assistant-card">
          <h3>会议时间智能建议</h3>
          <div className="days-wrap">
            {dayOptions.map((day) => (
              <button
                key={day}
                className={selectedDays.includes(day) ? 'active' : ''}
                onClick={() => toggleDay(day)}
              >
                {day}
              </button>
            ))}
          </div>
          <div className="row">
            <label>会议时长（分钟）</label>
            <input type="number" value={duration} onChange={(e) => setDuration(Number(e.target.value))} min={15} />
          </div>
          <button onClick={runScheduleSuggest}>生成建议时段</button>

          <ul className="result-list">
            {scheduleResult.map((s, idx) => (
              <li key={`${s.date}-${s.start_time}-${idx}`}>
                {s.date} {s.start_time}（{s.duration_minutes} 分钟）
              </li>
            ))}
          </ul>
        </div>

        <div className="assistant-card">
          <h3>任务拆解与执行建议</h3>
          <textarea
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            placeholder="输入一句复杂任务描述，例如：发布 1.0 版本，完成文档、联调和回归"
          />
          <button onClick={runTaskPlan}>拆解任务</button>
          {taskSummary && <p className="summary">{taskSummary}</p>}

          <ul className="result-list">
            {taskPlan.map((cp) => (
              <li key={cp.step}>
                <div>
                  {cp.step}. {cp.title} · {cp.eta}
                </div>
                <button onClick={() => saveCheckpointAsTask(cp)}>加入任务列表</button>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

export default AssistantHub;
