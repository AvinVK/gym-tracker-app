from .auth import bp as auth_bp
from .deploy import bp as deploy_bp
from .exercise_log import bp as exercise_log_bp
from .exercise_plan import bp as exercise_plan_bp
from .frontend import bp as frontend_bp
from .streak import bp as streak_bp
from .workout_log import bp as workout_log_bp

BLUEPRINTS = (
    frontend_bp,
    deploy_bp,
    auth_bp,
    exercise_plan_bp,
    workout_log_bp,
    exercise_log_bp,
    streak_bp,
)


def register_blueprints(app):
    for bp in BLUEPRINTS:
        app.register_blueprint(bp)
