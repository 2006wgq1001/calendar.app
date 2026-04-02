import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from './axiosConfig';
import './Profile.css';

const Profile = ({ user, setUser }) => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    username: '',
    name: '',
    email: '',
    bio: '',
    gender: '',
    birthdate: '',
    avatar: ''
  });
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [avatarPreview, setAvatarPreview] = useState('');

  useEffect(() => {
    if (user) {
      axios.get('/profile')
        .then(res => {
          if (res.data.success) {
            setProfile(res.data.user);
            setAvatarPreview(res.data.user.avatar || '');
          }
        })
        .catch(err => console.error('获取个人信息错误', err));
    }
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setProfile(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setAvatarPreview(reader.result);
        setProfile(prev => ({ ...prev, avatar: reader.result }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    try {
      const payload = {
        name: profile.name,
        gender: profile.gender,
        birthdate: profile.birthdate,
        avatar: profile.avatar,
        email: profile.email,
        bio: profile.bio,
      };
      console.log('Profile save payload:', payload);
      const res = await axios.put('/profile', payload);
      if (res.data.success) {
        setProfile(res.data.user);
        setAvatarPreview(res.data.user.avatar || '');
        // also inform parent of updated profile in case name/avatar changed
        if (setUser) {
          setUser(res.data.user);
        }
        setEditing(false);
      } else {
        setError(res.data.message || '保存失败，请检查输入');
      }
    } catch (err) {
      console.error('更新个人信息错误', err);
      // show server message if available or network error
      const msg = err.response?.data?.message || err.message || '保存失败，请稍后重试';
      setError(msg);
    }
  };

  return (
    <div className="profile-container">
      <button className="back-btn" onClick={() => navigate('/')}>返回主页</button>
      <h2>个人主页</h2>
      {error && <div className="error-message">{error}</div>}
      {user ? (
        <div className="profile-info">
          <div className="avatar-section">
            {avatarPreview ? (
              <img src={avatarPreview} alt="头像" className="avatar-image" />
            ) : (
              <div className="avatar-placeholder">头像</div>
            )}
            {editing && (
              <input type="file" accept="image/*" onChange={handleFileChange} />
            )}
          </div>

          <div className="top-row">
            <div className="form-group">
              <label>姓名：</label>
              {editing ? (
                <input
                  type="text"
                  name="name"
                  value={profile.name}
                  onChange={handleChange}
                  placeholder="请输入姓名"
                />
              ) : (
                <span>{profile.name || '未填写'}</span>
              )}
            </div>

            <div className="form-group">
              <label>性别：</label>
              {editing ? (
                <select name="gender" value={profile.gender} onChange={handleChange}>
                  <option value="">选择</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="其他">其他</option>
                </select>
              ) : (
                <span>{profile.gender || '未填写'}</span>
              )}
            </div>

            <div className="form-group">
              <label>出生年月日：</label>
              {editing ? (
                <input
                  type="date"
                  name="birthdate"
                  value={profile.birthdate}
                  onChange={handleChange}
                />
              ) : (
                <span>{profile.birthdate || '未填写'}</span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>邮箱：</label>
            {editing ? (
              <input
                type="email"
                name="email"
                value={profile.email}
                onChange={handleChange}
              />
            ) : (
              <span>{profile.email || '未填写'}</span>
            )}
          </div>
          <div className="form-group">
            <label>简介：</label>
            {editing ? (
              <textarea
                name="bio"
                value={profile.bio}
                onChange={handleChange}
              />
            ) : (
              <span>{profile.bio || '未填写'}</span>
            )}
          </div>

          {editing ? (
            <div className="button-row">
              <button onClick={handleSave} className="save-btn">保存</button>
              <button onClick={() => setEditing(false)} className="cancel-btn">取消</button>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="edit-btn">编辑信息</button>
          )}
        </div>
      ) : (
        <p>未登录</p>
      )}
    </div>
  );
};

export default Profile;
