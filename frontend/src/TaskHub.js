import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from './axiosConfig';
import './TaskHub.css';

const statusOptions = [
  { value: 'todo', label: '待开始' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
];

const priorityOptions = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

function TaskHub() {
  const navigate = useNavigate();
  const location = useLocation();
  const [teams, setTeams] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [membersByTeam, setMembersByTeam] = useState({});
  const [activeTeamId, setActiveTeamId] = useState('');
  const [taskFilter, setTaskFilter] = useState('all');
  const [newTeamName, setNewTeamName] = useState('');
  const [memberUsername, setMemberUsername] = useState('');

  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    due_date: '',
    assignee_id: '',
  });

  const currentMembers = useMemo(() => membersByTeam[activeTeamId] || [], [membersByTeam, activeTeamId]);
  const taskColumns = taskFilter === 'all'
    ? statusOptions
    : statusOptions.filter((x) => x.value === taskFilter);

  const fetchTeams = async () => {
    const response = await axios.get('/teams');
    const next = response.data || [];
    setTeams(next);
    if (!activeTeamId && next.length > 0) {
      setActiveTeamId(String(next[0].id));
    }
  };

  const fetchTasks = async () => {
    const suffix = activeTeamId ? `?team_id=${activeTeamId}` : '';
    const response = await axios.get(`/tasks${suffix}`);
    setTasks(response.data || []);
  };

  const fetchMembers = async (teamId) => {
    if (!teamId) return;
    try {
      const response = await axios.get(`/teams/${teamId}/members`);
      setMembersByTeam((prev) => ({ ...prev, [teamId]: response.data || [] }));
    } catch (error) {
      setMembersByTeam((prev) => ({ ...prev, [teamId]: [] }));
    }
  };

  useEffect(() => {
    fetchTeams().catch((e) => console.error(e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchTasks().catch((e) => console.error(e));
    fetchMembers(activeTeamId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTeamId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const status = params.get('status');
    if (status && statusOptions.some((x) => x.value === status)) {
      setTaskFilter(status);
    } else {
      setTaskFilter('all');
    }
  }, [location.search]);

  const createTeam = async () => {
    if (!newTeamName.trim()) return;
    await axios.post('/teams', { name: newTeamName.trim() });
    setNewTeamName('');
    await fetchTeams();
  };

  const addTeamMember = async () => {
    if (!activeTeamId || !memberUsername.trim()) return;
    await axios.post(`/teams/${activeTeamId}/members`, { username: memberUsername.trim() });
    setMemberUsername('');
    await fetchMembers(activeTeamId);
  };

  const createTask = async () => {
    if (!form.title.trim()) return;
    const payload = {
      ...form,
      title: form.title.trim(),
      team_id: activeTeamId || null,
      assignee_id: form.assignee_id ? Number(form.assignee_id) : null,
    };
    await axios.post('/tasks', payload);
    setForm({ title: '', description: '', priority: 'medium', status: 'todo', due_date: '', assignee_id: '' });
    await fetchTasks();
  };

  const updateTask = async (taskId, payload) => {
    await axios.put(`/tasks/${taskId}`, payload);
    await fetchTasks();
  };

  const removeTask = async (taskId) => {
    await axios.delete(`/tasks/${taskId}`);
    await fetchTasks();
  };

  return (
    <div className="task-page">
      <header className="task-header">
        <h2>任务管理系统</h2>
        <button onClick={() => navigate('/')}>返回工作台</button>
      </header>

      <section className="task-panels">
        <div className="task-panel left">
          <h3>团队</h3>
          <div className="inline-form">
            <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="新团队名称" />
            <button onClick={createTeam}>创建</button>
          </div>

          <ul className="simple-list">
            {teams.length === 0 && <li>暂无团队</li>}
            {teams.map((team) => (
              <li
                key={team.id}
                className={String(team.id) === String(activeTeamId) ? 'active' : ''}
                onClick={() => setActiveTeamId(String(team.id))}
              >
                <span>{team.name}</span>
                <small>{team.member_count} 人</small>
              </li>
            ))}
          </ul>

          <h4>成员管理</h4>
          <div className="inline-form">
            <input value={memberUsername} onChange={(e) => setMemberUsername(e.target.value)} placeholder="输入用户名邀请" />
            <button onClick={addTeamMember}>添加</button>
          </div>
          <ul className="simple-list compact">
            {currentMembers.map((m) => (
              <li key={m.id}>{m.user?.username}（{m.role}）</li>
            ))}
          </ul>
        </div>

        <div className="task-panel right">
          <div className="task-filter-row">
            <span>任务筛选：</span>
            <button
              className={taskFilter === 'all' ? 'active' : ''}
              onClick={() => setTaskFilter('all')}
            >
              全部
            </button>
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                className={taskFilter === opt.value ? 'active' : ''}
                onClick={() => setTaskFilter(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <h3>创建任务</h3>
          <div className="task-form-grid">
            <input
              value={form.title}
              onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
              placeholder="任务标题"
            />
            <input
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="任务描述"
            />
            <select value={form.priority} onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}>
              {priorityOptions.map((x) => <option key={x.value} value={x.value}>{x.label}优先级</option>)}
            </select>
            <select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}>
              {statusOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
            <input type="date" value={form.due_date} onChange={(e) => setForm((prev) => ({ ...prev, due_date: e.target.value }))} />
            <select value={form.assignee_id} onChange={(e) => setForm((prev) => ({ ...prev, assignee_id: e.target.value }))}>
              <option value="">默认分配给我</option>
              {currentMembers.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.user?.username}</option>
              ))}
            </select>
            <button onClick={createTask}>新增任务</button>
          </div>

          <h3>任务看板</h3>
          <div className="task-columns">
            {taskColumns.map((col) => (
              <div className="task-column" key={col.value}>
                <h4>{col.label}</h4>
                {(tasks || []).filter((t) => t.status === col.value).map((task) => (
                  <article className="task-card" key={task.id}>
                    <div className="task-title">{task.title}</div>
                    <div className="task-meta">
                      截止 {task.due_date || '未设置'} · {task.priority}
                    </div>
                    <p>{task.description || '无描述'}</p>
                    <div className="task-actions">
                      <select
                        value={task.status}
                        onChange={(e) => updateTask(task.id, { status: e.target.value })}
                      >
                        {statusOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                      </select>
                      <button onClick={() => removeTask(task.id)}>删除</button>
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default TaskHub;
