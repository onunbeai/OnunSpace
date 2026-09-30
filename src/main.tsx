import {Component,StrictMode,type ErrorInfo,type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {TooltipProvider} from './components/Tooltip';
import {ProjectErrorState} from './components/ProjectErrorState';
import './styles.css';
import './components/modal.css';
import './components/media/video-player.css';
class ErrorBoundary extends Component<{children:ReactNode},{error:boolean}>{state={error:false};static getDerivedStateFromError(){return{error:true};}componentDidCatch(_error:Error,_info:ErrorInfo){}render(){return this.state.error?<ProjectErrorState/>:this.props.children;}}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><TooltipProvider delayDuration={350} skipDelayDuration={100}><App/></TooltipProvider></ErrorBoundary></StrictMode>);
